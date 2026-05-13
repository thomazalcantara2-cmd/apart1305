declare const XLSX: any;

export const formatDate = (date: Date): string => {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '';
    // FIX: Added timeZone: 'UTC' to prevent the browser's local timezone
    // from shifting the date back by one day.
    return date.toLocaleDateString('pt-BR', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        timeZone: 'UTC' 
    });
};

export const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
};

export const sanitizePdfText = (text: string | null | undefined): string => {
    if (!text) return '';
    let sanitized = String(text);
    // Replace standard parentheses with brackets to avoid jsPDF parsing issues
    sanitized = sanitized.replace(/\(/g, '[').replace(/\)/g, ']');
    // Replace fullwidth parentheses with brackets
    sanitized = sanitized.replace(/（/g, '[').replace(/）/g, ']');
    // Remove emojis and other non-latin1 characters that break jsPDF standard fonts
    // Keep standard Portuguese characters (áéíóúãõç etc)
    // eslint-disable-next-line no-control-regex
    sanitized = sanitized.replace(/[^\x00-\xFF]/g, '');
    return sanitized;
};

export const exportToPdf = (title: string, headers: string[], data: any[][]) => {
    const doc = new (window as any).jspdf.jsPDF();
    doc.text(title, 14, 16);
    
    // Sanitize all text data to prevent jsPDF encoding issues
    const sanitizedData = data.map(row => 
        row.map(cell => typeof cell === 'string' ? sanitizePdfText(cell) : cell)
    );

    doc.autoTable({
        startY: 20,
        head: [headers],
        body: sanitizedData,
        theme: 'grid',
        styles: { fontSize: 8 },
        headStyles: { fillColor: [22, 160, 133] },
    });
    doc.save(`${title.replace(/ /g, '_')}.pdf`);
};

export const exportToExcel = (fileName: string, data: any[], extraSheets?: { name: string, data: any[] }[]) => {
    const workbook = XLSX.utils.book_new();

    const currencyCols = new Set<string>();
    const pctCols = new Set<string>();

    const detectColumnTypes = (rows: any[]) => {
        const cc = new Set<string>();
        const pc = new Set<string>();
        if (rows.length === 0) return { cc, pc };
        const keys = Object.keys(rows[0]);
        keys.forEach(k => {
            const kl = k.toLowerCase();
            if (kl.includes('receita') || kl.includes('despesa') || kl.includes('saldo') || kl.includes('valor') || kl.includes('total') || kl.includes('entradas') || kl.includes('(r$)'))
                cc.add(k);
            if (kl.includes('%') || kl.includes('ocupação') || kl.includes('ocupacao') || kl.includes('peso'))
                pc.add(k);
        });
        return { cc, pc };
    };

    const styleSheet = (ws: any, rows: any[], currKeys: Set<string>, pctKeys: Set<string>) => {
        if (!rows.length) return;
        const keys = Object.keys(rows[0]);
        const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
        const thinBorder = { style: 'thin', color: { rgb: 'CCCCCC' } };
        const border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
        const headerFill = { patternType: 'solid', fgColor: { rgb: '14259C' } };
        const headerFont = { bold: true, color: { rgb: 'FFFFFF' }, name: 'Arial', sz: 10 };
        const bodyFont = { name: 'Arial', sz: 9 };
        const totalFill = { patternType: 'solid', fgColor: { rgb: 'E8ECF5' } };
        const totalFont = { bold: true, name: 'Arial', sz: 10 };
        const brlFmt = '#,##0.00';

        for (let C = range.s.c; C <= range.e.c; ++C) {
            const addr = XLSX.utils.encode_cell({ r: 0, c: C });
            if (!ws[addr]) continue;
            ws[addr].s = { font: headerFont, fill: headerFill, border, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };
        }

        for (let R = 1; R <= range.e.r; ++R) {
            const isLastRow = R === range.e.r;
            const firstCellAddr = XLSX.utils.encode_cell({ r: R, c: 0 });
            const firstVal = ws[firstCellAddr]?.v;
            const isTotal = typeof firstVal === 'string' && (firstVal.toUpperCase().includes('TOTAL'));

            for (let C = range.s.c; C <= range.e.c; ++C) {
                const addr = XLSX.utils.encode_cell({ r: R, c: C });
                if (!ws[addr]) continue;
                const key = keys[C];
                const isCurr = currKeys.has(key);
                const isPct = pctKeys.has(key);
                const s: any = { font: isTotal ? totalFont : bodyFont, border, alignment: { vertical: 'center' } };
                if (isTotal) s.fill = totalFill;
                if (isCurr) {
                    s.numFmt = brlFmt;
                    s.alignment.horizontal = 'right';
                } else if (isPct) {
                    s.numFmt = '0.0"%"';
                    s.alignment.horizontal = 'right';
                }
                ws[addr].s = s;
            }
        }

        ws['!cols'] = keys.map((k) => {
            const kl = k.toLowerCase();
            if (kl.includes('mês') || kl.includes('mes') || kl.includes('flat')) return { wch: 12 };
            if (kl.includes('plataforma')) return { wch: 16 };
            if (kl.includes('hóspede') || kl.includes('hospede') || kl.includes('assoc')) return { wch: 25 };
            if (kl.includes('data')) return { wch: 12 };
            if (currKeys.has(k)) return { wch: 16 };
            return { wch: 14 };
        });

        ws['!rows'] = [{ hpx: 28 }];
    };

    // Build sheets in order: extra sheets first (TOTAIS POR PLATAFORMA), then main
    if (extraSheets) {
        extraSheets.forEach(es => {
            const ws = XLSX.utils.json_to_sheet(es.data);
            const { cc, pc } = detectColumnTypes(es.data);
            styleSheet(ws, es.data, cc, pc);
            XLSX.utils.book_append_sheet(workbook, ws, es.name);
        });
    }

    const mainWs = XLSX.utils.json_to_sheet(data);
    const { cc, pc } = detectColumnTypes(data);
    styleSheet(mainWs, data, cc, pc);
    XLSX.utils.book_append_sheet(workbook, mainWs, 'Detalhamento de Depósitos');

    XLSX.writeFile(workbook, `${fileName}.xlsx`);
};

export const getMonthName = (monthNumber: number): string => {
    const date = new Date(2000, monthNumber - 1, 1);
    return date.toLocaleString('pt-BR', { month: 'long' });
};

/**
 * Parses a date from various formats into a standardized UTC Date object.
 * Handles ISO strings, "DD/MM/AAAA", "DD MÊS. AAAA", numbers, and Date objects.
 * @param dateInput The date value to parse.
 * @returns A Date object, or an invalid Date if parsing fails.
 */
export const parseDate = (dateInput: any): Date => {
    if (dateInput === null || dateInput === undefined || dateInput === '') return new Date('invalid');

    // 1. Handle Date objects directly
    if (dateInput instanceof Date) {
        if (isNaN(dateInput.getTime())) return new Date('invalid');
        return new Date(Date.UTC(dateInput.getFullYear(), dateInput.getMonth(), dateInput.getDate()));
    }

    // 2. Handle numbers (Excel serial date)
    if (typeof dateInput === 'number') {
        const utcMilliseconds = (dateInput - 25569) * 86400 * 1000;
        const date = new Date(utcMilliseconds);
        return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    }
    
    // 3. Handle strings (most common case after fetching from API)
    if (typeof dateInput === 'string') {
        const dateStr = dateInput.trim();

        // A. Check for ISO 8601 format (e.g., "2025-12-30T..." or "2025-12-30")
        if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
                return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
            }
        }
        
        // B. Check for "DD/MM/AAAA" format
        if (dateStr.includes('/')) {
            const parts = dateStr.split('/');
            if (parts.length === 3) {
                const [day, month, year] = parts.map(p => parseInt(p, 10));
                if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
                    const fullYear = year < 100 ? 2000 + year : year;
                    const date = new Date(Date.UTC(fullYear, month - 1, day));
                    if (date.getUTCFullYear() === fullYear && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
                        return date;
                    }
                }
            }
        }

        // C. Check for "DD MÊS. AAAA" format (e.g., "30 dez. 2025")
        const monthMap: { [key: string]: number } = {
            'jan': 0, 'fev': 1, 'mar': 2, 'abr': 3, 'mai': 4, 'jun': 5,
            'jul': 6, 'ago': 7, 'set': 8, 'out': 9, 'nov': 10, 'dez': 11
        };
        const parts = dateStr.toLowerCase().split(' ');
        if (parts.length === 3) {
            const day = parseInt(parts[0], 10);
            const monthStr = parts[1].replace('.', '');
            const year = parseInt(parts[2], 10);
            const month = monthMap[monthStr];

            if (!isNaN(day) && month !== undefined && !isNaN(year)) {
                const date = new Date(Date.UTC(year, month, day));
                if (date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day) {
                    return date;
                }
            }
        }
    }
    
    return new Date('invalid');
};

/**
 * Remove acentos e caracteres especiais para uso nos campos de texto do XML Tinus.
 * O caractere & é permitido e preservado.
 */
export const sanitizeForXml = (text: string): string => {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ç/g, 'c').replace(/Ç/g, 'C')
    .replace(/[^\w\s\-.,()/&+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Formata número como decimal com N casas para uso no XML.
 * Sempre usa ponto como separador decimal.
 */
export const formatXmlDecimal = (value: number, decimals = 2): string => {
  return value.toFixed(decimals);
};

/**
 * Gets a field from a JSON object with case-insensitive and trimmed key matching.
 * Tolerates variations in column names.
 */
export const getField = (row: Record<string, any>, key: string): any => {
    if (!row || typeof row !== 'object') return undefined;
    const targetKey = key.trim().toLowerCase();
    
    // Check direct match first
    if (row[key] !== undefined) return row[key];
    
    // Case-insensitive search
    for (const k of Object.keys(row)) {
        if (k.trim().toLowerCase() === targetKey) {
            return row[k];
        }
    }
    
    return undefined;
};