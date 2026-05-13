
import { UNIFIED_DATA_API_URL } from '../constants';
import { Reservation, BankDeposit, UnifiedData, CleaningData, FinancialData, ManualConciliation, DismissedAutoMatch } from '../types';
import { parseDate } from '../utils/helpers';

/**
 * Parses a currency value from various formats (pt-BR, en-US, raw number) into a number.
 * This robust version correctly identifies decimal and thousand separators to avoid parsing errors.
 * @param value The currency value to parse.
 * @returns A number representing the currency value.
 */
const parseCurrency = (value: any): number => {
    if (value == null || value === '' || value === '-') return 0;
    if (typeof value === 'number') return isNaN(value) ? 0 : value;

    let str = String(value).trim().replace(/[^\d.,-]/g, '');

    const lastComma = str.lastIndexOf(',');
    const lastDot = str.lastIndexOf('.');

    // Case 1: Brazilian format (e.g., "1.234,56"). The comma is the decimal separator.
    if (lastComma > lastDot) {
        str = str.replace(/\./g, '').replace(',', '.');
    }
    // Case 2: American format ("1,234.56") or a format with only dots.
    else {
        // Commas are always thousands separators in this case, so remove them.
        str = str.replace(/,/g, '');

        const dotCount = (str.match(/\./g) || []).length;
        const lastDotIndex = str.lastIndexOf('.');

        // Heuristic: If there's exactly one dot and it's followed by 3 digits,
        // it's likely a thousands separator (e.g., "1.132").
        if (dotCount === 1 && str.length - lastDotIndex - 1 === 3) {
             str = str.replace('.', '');
        }
        // If there are multiple dots, assume the last one is decimal and remove the others.
        else if (dotCount > 1) {
            const integerPart = str.substring(0, lastDotIndex).replace(/\./g, '');
            const decimalPart = str.substring(lastDotIndex + 1);
            str = integerPart + '.' + decimalPart;
        }
    }

    const parsedValue = parseFloat(str);
    return isNaN(parsedValue) ? 0 : parsedValue;
};

// Helper to generate simple hash/slug from string.
// Removemos diacríticos via NFD antes do filtro [^\w-] porque o motor de regex
// JavaScript trata \w como ASCII puro — sem a normalização, "AGUSTÍN" e
// "AGUSTIN" geram slugs diferentes ("agustn..." vs "agustin..."), e o ID
// estável da reserva varia conforme a plataforma reexporta a grafia.
const slugify = (text: string) => {
    return text.toString()
        .normalize('NFD')
        // eslint-disable-next-line no-misleading-character-class
        .replace(/[\u0300-\u036f]/g, '') // remove acentos combinantes
        .toLowerCase()
        .replace(/\s+/g, '')           // Replace spaces with nothing
        .replace(/[^\w-]+/g, '')       // Remove all non-word chars
        .slice(0, 15);                 // Limit length
};

/**
 * Processa as reservas a partir de uma matriz [linhas][colunas], onde a linha 0
 * contém os cabeçalhos. Mesma forma de importação utilizada no Ape-Codex
 * (origem da planilha base). Compatível com o backend Apps Script que retorna
 * `reservationsData` como matriz pura.
 */
export const processReservations = (rows: any[][]): Reservation[] => {
    if (!rows || rows.length < 2) return [];

    const originalHeaders = rows[0]?.map(h => String(h).trim()) || [];
    const headers = originalHeaders.map(h => h.toLowerCase());
    const data = rows.slice(1);

    const headerMap: { [key: string]: number } = {};
    headers.forEach((header, i) => {
        // Não sobrescrever caso haja cabeçalhos duplicados — mantemos o primeiro
        if (headerMap[header] === undefined) {
            headerMap[header] = i;
        }
    });

    const requiredHeaders = [
        'data de checkout', 'nome interno do anúncio',
        'total da reserva', 'total de taxas do repasse',
        'nome do hóspede', 'canal'
    ];

    // 'chegada' OU 'data de check-in' é obrigatório (toleramos ambas as variações)
    if (headerMap['chegada'] === undefined && headerMap['data de check-in'] === undefined) {
        console.error(`Cabeçalho de reserva OBRIGATÓRIO ausente: "chegada" ou "data de check-in".`);
        alert(`A planilha de Reservas não tem a coluna "chegada" ou "data de check-in". Os nomes das colunas devem ser exatamente os esperados.\n\nColunas encontradas: ${originalHeaders.join(', ')}`);
        return [];
    }

    for (const h of requiredHeaders) {
        if (headerMap[h] === undefined) {
            console.error(`Cabeçalho de reserva OBRIGATÓRIO ausente: "${h}". Verifique o nome da coluna na sua planilha.`);
            alert(`A planilha de Reservas não tem a coluna "${h}". Os nomes das colunas devem ser exatamente os esperados.\n\nColunas encontradas: ${originalHeaders.join(', ')}`);
            return [];
        }
    }

    const checkInIdx = headerMap['chegada'] !== undefined ? headerMap['chegada'] : headerMap['data de check-in'];

    const allParsedReservations = data.map((row, index): Reservation | null => {
        const checkInValue = row[checkInIdx];
        const checkOutValue = row[headerMap['data de checkout']];
        const rawFlatName = String(row[headerMap['nome interno do anúncio']] || '').toUpperCase();
        const guestName = row[headerMap['nome do hóspede']];
        let channel = row[headerMap['canal']];
        const grossStr = row[headerMap['total da reserva']];
        const feesStr = row[headerMap['total de taxas do repasse']];

        let confirmationCode: string | undefined = undefined;
        if (headerMap['código de confirmação'] !== undefined) {
            confirmationCode = String(row[headerMap['código de confirmação']] || '').trim();
        } else if (headerMap['código da reserva'] !== undefined) {
            confirmationCode = String(row[headerMap['código da reserva']] || '').trim();
        }

        // Normalização robusta do nome do flat
        let flatName = rawFlatName;
        if (rawFlatName.includes('201')) flatName = '201';
        else if (rawFlatName.includes('202')) flatName = '202';
        else if (rawFlatName.includes('301')) flatName = '301';

        const channelStr = String(channel || '').trim();
        if (channelStr === '') {
            channel = 'Particular';
        } else {
            const lowerChannel = channelStr.toLowerCase();
            if (lowerChannel.includes('api airbnb')) {
                channel = 'AIRBNB';
            } else if (lowerChannel.includes('api booking.com')) {
                channel = 'BOOKING';
            } else if (lowerChannel.includes('decolar')) {
                channel = 'DECOLAR';
            }
        }

        const checkIn = parseDate(checkInValue);
        if (isNaN(checkIn.getTime())) return null;

        const checkOut = parseDate(checkOutValue);
        if (isNaN(checkOut.getTime())) return null;

        if (!flatName) return null;

        const grossEarnings = parseCurrency(grossStr);
        const fees = parseCurrency(feesStr);

        const checkInStr = checkIn.toISOString().split('T')[0].replace(/-/g, '');
        const guestSlug = slugify(String(guestName));
        const stableId = `RES-${flatName}-${checkInStr}-${guestSlug}`;

        return {
            id: stableId,
            checkIn,
            checkOut,
            guestName: String(guestName).toUpperCase(),
            flat: flatName,
            platform: channel,
            grossEarnings,
            fees,
            netEarnings: grossEarnings - fees,
            confirmationCode: confirmationCode || undefined
        };
    }).filter((r): r is Reservation => r !== null);

    const uniqueReservations = new Map<string, Reservation>();
    for (const res of allParsedReservations) {
        uniqueReservations.set(res.id, res);
    }

    return Array.from(uniqueReservations.values());
};


export const processDeposits = (rows: any[][]): BankDeposit[] => {
    if (rows.length < 2) return [];

    const headers = rows[0].map(h => String(h).trim());
    const dataRows = rows.slice(1);

    const dateIndex = headers.indexOf('Data');
    const descriptionIndex = headers.indexOf('Descrição');
    const valueIndex = headers.indexOf('Valor');

    if (dateIndex === -1 || descriptionIndex === -1 || valueIndex === -1) return [];

    const seenIds = new Set<string>();

    return dataRows.map((row, index) => {
        if (row.length <= Math.max(dateIndex, descriptionIndex, valueIndex)) return null;

        const amount = parseCurrency(row[valueIndex]);
        if (amount <= 0) return null;

        const date = parseDate(row[dateIndex]);
        if (isNaN(date.getTime())) return null;

        const description = String(row[descriptionIndex] || '');
        const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
        const amountStr = Math.round(amount * 100).toString();
        const descSlug = slugify(description);
        const baseId = `DEP-${dateStr}-${amountStr}-${descSlug}`;

        let stableId = baseId;
        let count = 1;
        while (seenIds.has(stableId)) {
            count++;
            stableId = `${baseId}-${count}`;
        }
        seenIds.add(stableId);

        return {
            id: stableId,
            date,
            description,
            amount,
        };
    }).filter((d): d is BankDeposit => d !== null);
};

export const fetchInitialData = async () => {
    const timestamp = new Date().getTime();
    const url = `${UNIFIED_DATA_API_URL.trim()}?v=${timestamp}`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Erro de comunicação com a API (${response.status}).`);
        const data = await response.json();
        if (data.status === 'error') throw new Error(`A API retornou um erro: "${data.message}"`);

        const reservationsData = data.reservations || [];
        const depositsData = data.deposits || [];
        const unifiedData: UnifiedData = data.unifiedData || {};
        const manualConciliationsData = data.manualConciliations || [];
        const dismissedAutoMatchesData = data.dismissedAutoMatches || [];

        const manualConciliations: ManualConciliation[] = manualConciliationsData.map((row: any) => ({
             id: row.id,
             reservationIds: Array.isArray(row.reservationIds) ? row.reservationIds : String(row.reservationIds || '').split(','),
             depositIds: Array.isArray(row.depositIds) ? row.depositIds : String(row.depositIds || '').split(','),
             adjustment: Number(row.adjustment) || 0,
        }));

        const dismissedAutoMatches: DismissedAutoMatch[] = dismissedAutoMatchesData.map((row: any) => ({
             id: row.id,
             reservationIds: Array.isArray(row.reservationIds) ? row.reservationIds : String(row.reservationIds || '').split(','),
             depositId: row.depositId,
        }));

        return { reservationsData, depositsData, unifiedData, manualConciliations, dismissedAutoMatches };
    } catch (error) {
        console.error("Falha na requisição de dados:", error);
        throw error;
    }
};

const postData = async (payload: object): Promise<Response> => {
    const url = UNIFIED_DATA_API_URL.trim();
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Erro de comunicação com a API ao salvar.`);
    return response;
};


export const saveConfigData = async (
    dataType: 'financialConfig' | 'cleaningConfig' | 'financialConfig301',
    key: string,
    data: CleaningData | FinancialData
): Promise<Response> => {
    return postData({ dataType, key, data });
};

export const saveNfseData = async (
    dataType: 'nfseCompanyConfig' | 'nfseRecords',
    key: string,
    data: any
): Promise<Response> => {
    // Use 'financialConfig' as dataType to ensure the backend saves it in the unified data sheet
    return postData({ dataType: 'financialConfig', key, data });
};

export const saveNewReservation = async (reservationData: Omit<Reservation, 'id' | 'netEarnings'>): Promise<Response> => {
    return postData({ dataType: 'newReservation', data: reservationData });
};

/**
 * Envia a planilha de reservas para o backend como matriz [linhas][colunas]
 * (cabeçalho na linha 0). Mesmo formato do Ape-Codex.
 *
 * `month` e `year` são preservados como parâmetros opcionais para o backend
 * usar como filtro de substituição parcial (ex: substituir somente as reservas
 * do mês X). Se omitidos, o backend faz substituição completa.
 */
export const uploadReservationsSheet = async (sheetData: any[][], month?: number, year?: number): Promise<Response> => {
    const payload: any = {
        dataType: 'bulkUpdateReservations',
        key: 'bulk_update_reservations',
        data: sheetData,
    };
    if (month !== undefined) payload.month = month;
    if (year !== undefined) payload.year = year;
    return postData(payload);
};

export const uploadDepositsSheet = async (sheetData: any[][], month?: number, year?: number): Promise<Response> => {
    const payload: any = {
        dataType: 'bulkUpdateDeposits',
        key: 'bulk_update_deposits',
        data: sheetData,
    };
    if (month !== undefined) payload.month = month;
    if (year !== undefined) payload.year = year;
    return postData(payload);
};

export const saveManualConciliations = async (conciliations: ManualConciliation[]): Promise<Response> => {
    return postData({
        dataType: 'saveManualConciliations',
        key: 'manual_conciliations',
        data: conciliations.map(c => ({ ...c, reservationIds: c.reservationIds.join(','), depositIds: c.depositIds.join(',') }))
    });
};

export const saveDismissedAutoMatches = async (dismissedMatches: DismissedAutoMatch[]): Promise<Response> => {
    return postData({
        dataType: 'saveDismissedAutoMatches',
        key: 'dismissed_auto_matches',
        data: dismissedMatches.map(d => ({ ...d, reservationIds: d.reservationIds.join(',') }))
    });
};
