
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ReportType, Reservation, BankDeposit, UnifiedData, ManualConciliation, DismissedAutoMatch, NfseRecord, FinancialData } from './types';
import { fetchInitialData, processReservations, processDeposits, uploadReservationsSheet, uploadDepositsSheet, saveManualConciliations, saveDismissedAutoMatches } from './services/dataService';
import { extractDataFromPDF } from './utils/pdfParser';
import { extractDataFromExcelStatement } from './utils/excelStatementParser';
import { remapManualConciliations, remapDismissedAutoMatches } from './utils/conciliationMigration';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './components/Dashboard';
import ReceptionCleaningReport from './components/reports/ReceptionCleaningReport';
import LaundryControlReport from './components/reports/LaundryControlReport';
import FinancialReport from './components/reports/FinancialReport';
import ExpenseEntryReport from './components/reports/ExpenseEntryReport';
import CarneLeaoReport from './components/reports/CarneLeaoReport';
import CompensationReport from './components/reports/CompensationReport';
import InteractiveCompensationReport from './components/reports/InteractiveCompensationReport';
import YearlyFinancialSummaryReport from './components/reports/YearlyFinancialSummaryReport';
import DynamicPricingReport from './components/reports/DynamicPricingReport';
import CashFlowReport from './components/reports/CashFlowReport';
import YearlyCashFlowReport from './components/reports/YearlyCashFlowReport';
import CashAccrualCompareReport from './components/reports/CashAccrualCompareReport';
import CalendarReport from './components/reports/CalendarReport';
import FixedCostsReport from './components/reports/FixedCostsReport';
import NfseControlReport from './components/reports/NfseControlReport';
import FiscalReport from './components/reports/FiscalReport';
import ManualDepositModal from './components/ManualDepositModal';
import Tour from './components/Tour';
import { CARNE_LEAO_TAX_BRACKETS, CONDOMINIO_201_FIXED, CONDOMINIO_202_FIXED, SIMPLES_NACIONAL_BRACKETS } from './constants';

declare const XLSX: any;

const App: React.FC = () => {
    const [activeReport, setActiveReport] = useState<ReportType>(ReportType.Dashboard);
    const [allReservations, setAllReservations] = useState<Reservation[]>([]);
    const [allDeposits, setAllDeposits] = useState<BankDeposit[]>([]);
    const [unifiedData, setUnifiedData] = useState<UnifiedData>({});
    const [manualConciliations, setManualConciliations] = useState<ManualConciliation[]>([]);
    const [dismissedAutoMatches, setDismissedAutoMatches] = useState<DismissedAutoMatch[]>([]);

    const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
    const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
    const [searchTerm, setSearchTerm] = useState<string>('');

    const [manualAdjustments, setManualAdjustments] = useState<Record<string, number>>({});
    const [isSidebarMinimized, setIsSidebarMinimized] = useState<boolean>(false);
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);
    const [isUploading, setIsUploading] = useState(false);
    const [manualDepositModal, setManualDepositModal] = useState(false);
    // Atalho de "Competência × Caixa" → Conciliação Manual
    const [pendingManualConciliationReservationId, setPendingManualConciliationReservationId] = useState<string | null>(null);
    
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pdfInputRef = useRef<HTMLInputElement>(null);
    
    const [startTour, setStartTour] = useState(false);
    const [theme, setTheme] = useState<'light' | 'dark'>('light');
    const [fontSize, setFontSize] = useState<number>(100);

    const [importConfirmation, setImportConfirmation] = useState<{
        isOpen: boolean;
        type: 'reservations' | 'deposits';
        data: any[];
        message: string;
        selectedMonth: number;
        selectedYear: number;
    } | null>(null);
    const [alertMessage, setAlertMessage] = useState<string | null>(null);

    useEffect(() => {
        const savedFontSize = localStorage.getItem('fontSize');
        if (savedFontSize) setFontSize(Number(savedFontSize));
        const savedTheme = localStorage.getItem('theme') as 'light' | 'dark';
        if (savedTheme) setTheme(savedTheme);
    }, []);

    useEffect(() => {
        document.documentElement.style.fontSize = `${fontSize}%`;
        localStorage.setItem('fontSize', String(fontSize));
    }, [fontSize]);

    useEffect(() => {
        if (theme === 'dark') document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

    const loadData = useCallback(async () => {
        try {
            const fetched = await fetchInitialData();
            const reservations = processReservations(fetched.reservationsData || []);
            const deposits = processDeposits(fetched.depositsData || []);
            
            // Conciliações manuais e dismissals são persistidos como listas de IDs
            // de reservas/depósitos. Como esses IDs são regerados a cada
            // processReservations/processDeposits, qualquer mudança na origem dos
            // dados (reimportação de planilha, novo depósito, nome do hóspede com
            // grafia ligeiramente diferente, reordenação de duplicatas) pode
            // deixar conciliações antigas "órfãs" apontando para IDs inexistentes.
            // O remap abaixo faz uma resolução tolerante por assinatura
            // (flat+data+nome para reservas; data+valor+desc para depósitos) e
            // reescreve os IDs em memória antes de popular o estado.
            // NÃO persistimos a remapeação automaticamente — a próxima vez que o
            // usuário criar/desfizer uma conciliação na UI, a versão corrigida
            // será gravada via `saveManualConciliations`, fechando o ciclo.
            const fetchedManualConciliations = fetched.manualConciliations || [];
            const fetchedDismissedAutoMatches = fetched.dismissedAutoMatches || [];

            const mcResult = remapManualConciliations(fetchedManualConciliations, reservations, deposits);
            const dmResult = remapDismissedAutoMatches(fetchedDismissedAutoMatches, reservations, deposits);

            if (mcResult.changed) {
                // eslint-disable-next-line no-console
                console.info(
                    `[conciliationMigration] Conciliações manuais ajustadas: ` +
                    `${mcResult.remappedCount} IDs remapeados, ${mcResult.droppedCount} órfãs descartadas.`
                );
            }
            if (dmResult.changed) {
                // eslint-disable-next-line no-console
                console.info(
                    `[conciliationMigration] Dismissals ajustados: ` +
                    `${dmResult.remappedCount} IDs remapeados, ${dmResult.droppedCount} órfãos descartados.`
                );
            }

            setAllReservations(reservations || []);
            setAllDeposits(deposits || []);
            setUnifiedData(fetched.unifiedData || {});
            setManualConciliations(mcResult.items);
            setDismissedAutoMatches(dmResult.items);

        } catch (err) {
            console.error("Failed to load initial data:", err);
        }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setIsUploading(true);
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
                const worksheet = workbook.Sheets[workbook.SheetNames[0]];

                // Forma de importação herdada do Ape-Codex: matriz [linhas][colunas],
                // com cabeçalho na linha 0. É o formato esperado por
                // processReservations e pelo backend Apps Script.
                const sheetAsArray: any[][] = XLSX.utils.sheet_to_json(worksheet, {
                    header: 1,
                    defval: "",
                    blankrows: false,
                });

                if (!sheetAsArray || sheetAsArray.length < 2) {
                    setAlertMessage(`O arquivo "${file.name}" não contém linhas de dados.`);
                    return;
                }

                // Construir headerMap a partir da linha 0
                const originalHeaders = (sheetAsArray[0] || []).map((h: any) => String(h).trim());
                const headersLc = originalHeaders.map(h => h.toLowerCase());
                const headerMap: Record<string, number> = {};
                headersLc.forEach((h, i) => {
                    if (headerMap[h] === undefined) headerMap[h] = i;
                });

                const checkInIdx = headerMap['chegada'] !== undefined
                    ? headerMap['chegada']
                    : headerMap['data de check-in'];

                if (checkInIdx === undefined) {
                    setAlertMessage(`A planilha "${file.name}" não tem a coluna "chegada" ou "data de check-in". Verifique os cabeçalhos.\n\nColunas encontradas: ${originalHeaders.join(', ')}`);
                    return;
                }

                // Filtrar apenas reservas de 2026 — preservando a linha de cabeçalho.
                const headerRow = sheetAsArray[0];
                const dataRows = sheetAsArray.slice(1);

                const rowsOf2026 = dataRows.filter(row => {
                    const val = row[checkInIdx];
                    let year: number | null = null;

                    if (val instanceof Date) {
                        year = val.getFullYear();
                    } else if (typeof val === 'number') {
                        // Excel serial date
                        const utcMs = (val - 25569) * 86400 * 1000;
                        const d = new Date(utcMs);
                        if (!isNaN(d.getTime())) year = d.getUTCFullYear();
                    } else if (typeof val === 'string' && val.trim() !== '') {
                        const parts = val.split('/');
                        if (parts.length === 3) {
                            let y = parseInt(parts[2], 10);
                            if (!isNaN(y)) {
                                if (y < 100) y += 2000;
                                year = y;
                            }
                        } else {
                            const d = new Date(val);
                            if (!isNaN(d.getTime())) year = d.getFullYear();
                        }
                    }

                    return year === 2026;
                });

                const filteredArray: any[][] = [headerRow, ...rowsOf2026];
                const resCount = rowsOf2026.length;

                setImportConfirmation({
                    isOpen: true,
                    type: 'reservations',
                    data: filteredArray,
                    message: `Encontradas ${resCount} reservas de 2026 no arquivo "${file.name}". Os dados de 2025 não serão afetados. Deseja prosseguir com a importação?`,
                    selectedMonth: 1,
                    selectedYear: 2026
                });
            } catch (error) {
                setAlertMessage(`Erro ao processar a planilha: ${error}`);
            } finally {
                setIsUploading(false);
                event.target.value = '';
            }
        };
        reader.readAsBinaryString(file);
    };

    const handleManualDepositSave = async (depositRow: any[], month: number, year: number) => {
        setIsUploading(true);
        try {
            // 1. Pega os depósitos existentes do mês/ano selecionado
            const existingRows: any[][] = allDeposits
                .filter(d => d.date.getMonth() + 1 === month && d.date.getFullYear() === year)
                .map(d => {
                    const day = String(d.date.getDate()).padStart(2, '0');
                    const mon = String(d.date.getMonth() + 1).padStart(2, '0');
                    return [`${day}/${mon}/${d.date.getFullYear()}`, d.description, d.amount];
                });

            // 2. Monta o array completo: cabeçalho + existentes + novo
            const sheetData: any[][] = [
                ['Data', 'Descrição', 'Valor'],
                ...existingRows,
                depositRow,
            ];

            // 3. Envia via uploadDepositsSheet (mesmo endpoint do fluxo normal)
            await uploadDepositsSheet(sheetData, month, year);
            await loadData();
            setManualDepositModal(false);
            setAlertMessage('Depósito lançado com sucesso!');
        } catch (error) {
            setAlertMessage(`Erro ao salvar depósito manual: ${error}`);
        } finally {
            setIsUploading(false);
        }
    };

    const handlePdfUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setIsUploading(true);
        try {
            let extractedData: any[][] = [];
            if (file.name.toLowerCase().endsWith('.pdf')) {
                extractedData = await extractDataFromPDF(file);
            } else if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls') || file.name.toLowerCase().endsWith('.csv')) {
                extractedData = await extractDataFromExcelStatement(file);
            } else {
                throw new Error("Formato de arquivo não suportado.");
            }
            
            const depositCount = extractedData.length > 0 ? extractedData.length - 1 : 0;
            
            setImportConfirmation({
                isOpen: true,
                type: 'deposits',
                data: extractedData,
                message: `Foram encontrados ${depositCount} depósitos no arquivo "${file.name}". Selecione o mês e o ano que deseja substituir por estes dados.`,
                selectedMonth: new Date().getMonth() + 1,
                selectedYear: new Date().getFullYear()
            });
        } catch (error) {
            setAlertMessage(`Erro ao importar extrato: ${error}`);
        } finally {
            setIsUploading(false);
            event.target.value = '';
        }
    };

    const confirmImport = async () => {
        if (!importConfirmation) return;
        
        setIsUploading(true);
        try {
            if (importConfirmation.type === 'deposits') {
                await uploadDepositsSheet(importConfirmation.data as any[][], importConfirmation.selectedMonth, importConfirmation.selectedYear);
                loadData();
                setImportConfirmation(null);
                setAlertMessage("Importação concluída com sucesso!");
            } else {
                // Dados em formato matriz [linhas][colunas] (cabeçalho na linha 0).
                const fullArray = importConfirmation.data as any[][];
                if (!fullArray || fullArray.length < 2) {
                    setImportConfirmation(null);
                    setAlertMessage("Nenhuma reserva de 2026 válida encontrada para importar.");
                    setIsUploading(false);
                    return;
                }

                const headerRow = fullArray[0];
                const dataRows = fullArray.slice(1);

                // Reconstruir headerMap para localizar a coluna de chegada
                const headersLc = (headerRow || []).map((h: any) => String(h).trim().toLowerCase());
                const headerMap: Record<string, number> = {};
                headersLc.forEach((h, i) => {
                    if (headerMap[h] === undefined) headerMap[h] = i;
                });
                const checkInIdx = headerMap['chegada'] !== undefined
                    ? headerMap['chegada']
                    : headerMap['data de check-in'];

                if (checkInIdx === undefined) {
                    throw new Error("Coluna 'chegada' ou 'data de check-in' não encontrada na planilha.");
                }

                // Segmentar linhas por mês (todas pertencentes a 2026, conforme filtro
                // aplicado em handleFileUpload).
                const dataByMonth: Record<number, any[][]> = {};
                for (const row of dataRows) {
                    const val = row[checkInIdx];
                    let month = -1;

                    if (val instanceof Date) {
                        month = val.getMonth() + 1;
                    } else if (typeof val === 'number') {
                        const utcMs = (val - 25569) * 86400 * 1000;
                        const d = new Date(utcMs);
                        if (!isNaN(d.getTime())) month = d.getUTCMonth() + 1;
                    } else if (typeof val === 'string' && val.trim() !== '') {
                        const parts = val.split('/');
                        if (parts.length === 3) {
                            const m = parseInt(parts[1], 10);
                            if (!isNaN(m)) month = m;
                        } else {
                            const d = new Date(val);
                            if (!isNaN(d.getTime())) month = d.getMonth() + 1;
                        }
                    }

                    if (month >= 1 && month <= 12) {
                        if (!dataByMonth[month]) dataByMonth[month] = [];
                        dataByMonth[month].push(row);
                    }
                }

                const months = Object.keys(dataByMonth).map(Number).sort((a, b) => a - b);
                const totalMonths = months.length;
                let currentIdx = 1;

                if (totalMonths === 0) {
                    setImportConfirmation(null);
                    setAlertMessage("Nenhuma reserva válida de 2026 encontrada para importar.");
                    setIsUploading(false);
                    return;
                }

                for (const month of months) {
                    const monthName = new Date(2000, month - 1, 1).toLocaleString('pt-BR', { month: 'long' });
                    setImportConfirmation(prev => prev ? {
                        ...prev,
                        message: `Enviando ${monthName}/2026... (${currentIdx++}/${totalMonths})`
                    } : null);

                    // Cada lote enviado ao backend deve incluir a linha de cabeçalho.
                    const monthlyArray: any[][] = [headerRow, ...dataByMonth[month]];
                    await uploadReservationsSheet(monthlyArray, month, 2026);
                }

                loadData();
                setImportConfirmation(null);
                setAlertMessage(`Importação concluída! ${totalMonths} meses de 2026 foram atualizados.`);
            }
        } catch (error) {
            setAlertMessage(`Erro ao salvar importação: ${error}`);
        } finally {
            setIsUploading(false);
        }
    };

    const availableYears = useMemo(() => {
        const years = new Set<number>();
        (allReservations || []).forEach(r => years.add(r.checkIn.getUTCFullYear()));
        (allDeposits || []).forEach(d => years.add(d.date.getUTCFullYear()));
        if (years.size === 0) years.add(new Date().getFullYear());
        return Array.from(years).sort((a, b) => b - a);
    }, [allReservations, allDeposits]);

    const calculateCarneLeaoForYear = useCallback((year: number, deposits: BankDeposit[], unifiedData: UnifiedData) => {
        const results = [];
        let excessExpenseCarryover = 0;
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;
    
        for (let month = 1; month <= 12; month++) {
            if (year === currentYear && month > currentMonth) break;
            
            const financialConfigKey = `financialConfig-${year}-${month}`;
            const financialData = unifiedData[financialConfigKey] as FinancialData;
            const monthlyRevenue = (deposits || [])
                .filter(d => d.date.getUTCFullYear() === year && d.date.getUTCMonth() + 1 === month)
                .reduce((sum, d) => sum + d.amount, 0);
            
            let monthlyDeductibleExpenses = 0;
            const expenseDetails: Record<string, number> = {};

            if (financialData?.deductibleExpenses) {
                const de = financialData.deductibleExpenses;
                ['condominio', 'taxaExtra', 'energia', 'iptu', 'condominio202', 'taxaExtra202', 'energia202', 'iptu202'].forEach(key => {
                    const value = Number(de[key]) || 0;
                    if (value > 0) { expenseDetails[key] = value; monthlyDeductibleExpenses += value; }
                });
                if (monthlyRevenue > 0 && monthlyDeductibleExpenses === 0) {
                    monthlyDeductibleExpenses = CONDOMINIO_201_FIXED + CONDOMINIO_202_FIXED;
                }
            } else if (monthlyRevenue > 0) {
                monthlyDeductibleExpenses = CONDOMINIO_201_FIXED + CONDOMINIO_202_FIXED;
            }
            
            const calculationBaseRaw = monthlyRevenue - monthlyDeductibleExpenses;
            let creditUsed = 0;
            if (calculationBaseRaw > 0 && excessExpenseCarryover > 0) {
                creditUsed = Math.min(calculationBaseRaw, excessExpenseCarryover);
                excessExpenseCarryover -= creditUsed;
            }
            const finalCalculationBase = calculationBaseRaw - creditUsed;
            let taxDue = 0;
            if (finalCalculationBase > 0) {
                const bracket = CARNE_LEAO_TAX_BRACKETS.find(b => finalCalculationBase <= b.limit);
                if (bracket) taxDue = (finalCalculationBase * bracket.rate) - bracket.deduction;
            } else {
                excessExpenseCarryover += Math.abs(finalCalculationBase);
            }
            
            results.push({
                month, revenue: monthlyRevenue, expenses: monthlyDeductibleExpenses,
                expenseDetails, creditUsed, calculationBase: Math.max(0, finalCalculationBase),
                taxDue: Math.max(0, taxDue), excessCarryover: excessExpenseCarryover,
            });
        }
        return results;
    }, []);

    // NOVO: Calcula o imposto pelo Simples Nacional (Anexo III — LC 123/2006)
    // A lógica usa a Receita Bruta acumulada nos últimos 12 meses (RBT12) para
    // determinar a faixa e calcular a alíquota efetiva do mês.
    const calculateSimplesNacionalForYear = useCallback((
        year: number,
        unifiedData: UnifiedData
    ) => {
        const results = [];
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;

        // Extrai todos os registros de NFS-e do unifiedData
        const nfseRecordsObj = (unifiedData['nfseRecords'] as Record<string, NfseRecord>) || {};
        const allNfseRecords = Object.values(nfseRecordsObj);

        // Helper: soma grossValue das NFS-e de um mês/ano específico
        const getNfseRevenue = (y: number, m: number): number =>
            allNfseRecords
                .filter(r => r.competenceYear === y && r.competenceMonth === m)
                .reduce((sum, r) => sum + (r.grossValue || 0), 0);

        for (let month = 1; month <= 12; month++) {
            if (year === currentYear && month > currentMonth) break;

            // Receita do mês = grossValue das NFS-e do mês de competência
            const monthlyRevenue = getNfseRevenue(year, month);

            // RBT12 = soma dos últimos 12 meses (incluindo o mês atual) de NFS-e emitidas
            let rbt12 = 0;
            for (let i = 0; i < 12; i++) {
                let y = year;
                let m = month - i;
                if (m <= 0) { m += 12; y -= 1; }
                rbt12 += getNfseRevenue(y, m);
            }

            // Encontra a faixa do Simples Nacional pela RBT12
            const bracket = SIMPLES_NACIONAL_BRACKETS.find(b => rbt12 <= b.limit);
            let taxDue = 0;
            let effectiveRate = 0;

            if (bracket && rbt12 > 0 && monthlyRevenue > 0) {
                // Alíquota efetiva = (RBT12 × alíquota nominal − valor a deduzir) / RBT12
                effectiveRate = ((rbt12 * bracket.rate) - bracket.deduction) / rbt12;
                effectiveRate = Math.max(0, effectiveRate); // nunca negativo
                taxDue = monthlyRevenue * effectiveRate;
            }

            results.push({
                month,
                revenue: monthlyRevenue,       // receita = NFS-e emitidas
                rbt12,                         // RBT12 acumulado
                effectiveRate,                 // alíquota efetiva calculada
                expenses: 0,                   // Simples não tem dedução de despesas na base
                creditUsed: 0,
                calculationBase: monthlyRevenue,
                taxDue: Math.max(0, taxDue),
                excessCarryover: 0,
                expenseDetails: {},
            });
        }
        return results;
    }, []);

    const carneLeaoData = useMemo(() => {
        const data: Record<number, any[]> = {};
        availableYears.forEach(y => {
            if (y >= 2026) {
                data[y] = calculateSimplesNacionalForYear(y, unifiedData);
            } else {
                data[y] = calculateCarneLeaoForYear(y, allDeposits, unifiedData);
            }
        });
        return data;
    }, [availableYears, allDeposits, unifiedData, calculateSimplesNacionalForYear, calculateCarneLeaoForYear]);

    const handleDismissAutoMatch = async (reservationIds: string[], depositId: string) => {
        const newDismissed = [...dismissedAutoMatches, { id: `DIS-${Date.now()}`, reservationIds, depositId }];
        setDismissedAutoMatches(newDismissed);
        try {
            await saveDismissedAutoMatches(newDismissed);
        } catch (error) {
            console.error("Failed to save dismissed match:", error);
            setAlertMessage("Erro ao salvar a exclusão da conciliação automática.");
        }
    };

    const handleRestoreAutoMatch = async (dismissedId: string) => {
        const newDismissed = dismissedAutoMatches.filter(d => d.id !== dismissedId);
        setDismissedAutoMatches(newDismissed);
        try {
            await saveDismissedAutoMatches(newDismissed);
        } catch (error) {
            console.error("Failed to save restored match:", error);
            setAlertMessage("Erro ao restaurar a conciliação automática.");
        }
    };

    return (
        <div className="flex h-screen font-sans">
             <Tour startTour={startTour} onTourComplete={() => setStartTour(false)} setActiveReport={setActiveReport} />
             <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".xlsx, .xls" />
             <input type="file" ref={pdfInputRef} onChange={handlePdfUpload} className="hidden" accept=".pdf, .xlsx, .xls, .csv" />
            <Sidebar
                activeReport={activeReport} setActiveReport={setActiveReport}
                isSidebarMinimized={isSidebarMinimized} setIsSidebarMinimized={setIsSidebarMinimized}
                isMobileSidebarOpen={isMobileSidebarOpen} setIsMobileSidebarOpen={setIsMobileSidebarOpen}
                onImportClick={() => fileInputRef.current?.click()} onImportPdfClick={() => pdfInputRef.current?.click()}
                onManualDepositClick={() => setManualDepositModal(true)}
                isUploading={isUploading}
                fontSize={fontSize}
            />
            <div className="flex-1 flex flex-col overflow-hidden">
                <Header 
                    searchTerm={searchTerm} setSearchTerm={setSearchTerm} onMenuClick={() => setIsMobileSidebarOpen(true)}
                    availableYears={availableYears} selectedYear={selectedYear} setSelectedYear={setSelectedYear}
                    selectedMonth={selectedMonth} setSelectedMonth={setSelectedMonth}
                    theme={theme} toggleTheme={toggleTheme}
                    fontSize={fontSize} setFontSize={setFontSize}
                    activeReport={activeReport}
                    onImportClick={() => fileInputRef.current?.click()}
                    onImportPdfClick={() => pdfInputRef.current?.click()}
                    onManualDepositClick={() => setManualDepositModal(true)}
                    isUploading={isUploading}
                />
                <main className="flex-1 overflow-x-hidden overflow-y-auto">
                    <div className="p-4 md:p-6">
                        {activeReport === ReportType.Dashboard && <Dashboard reservations={allReservations} deposits={allDeposits} unifiedData={unifiedData} selectedYear={selectedYear} selectedMonth={selectedMonth} manualConciliations={manualConciliations} setActiveReport={setActiveReport} onStartTour={() => setStartTour(true)} carneLeaoData={carneLeaoData} />}
                        {activeReport === ReportType.ReceptionCleaning && <ReceptionCleaningReport reservations={allReservations} unifiedData={unifiedData} selectedYear={selectedYear} selectedMonth={selectedMonth} searchTerm={searchTerm} onDataSave={(k, d) => setUnifiedData(prev => ({...prev, [k]: d}))} />}
                        {activeReport === ReportType.LaundryControl && <LaundryControlReport reservations={allReservations} unifiedData={unifiedData} selectedYear={selectedYear} selectedMonth={selectedMonth} searchTerm={searchTerm} onDataSave={(k, d) => setUnifiedData(prev => ({...prev, [k]: d}))} />}
                        {activeReport === ReportType.Financial && <FinancialReport reservations={allReservations} unifiedData={unifiedData} selectedYear={selectedYear} selectedMonth={selectedMonth} searchTerm={searchTerm} onDataSave={(k, d) => setUnifiedData(prev => ({...prev, [k]: d}))} carneLeaoData={carneLeaoData} />}
                        {activeReport === ReportType.ExpenseEntry && <ExpenseEntryReport unifiedData={unifiedData} selectedYear={selectedYear} selectedMonth={selectedMonth} onDataSave={(k, d) => setUnifiedData(prev => ({...prev, [k]: d}))} />}
                        {(activeReport === ReportType.CarneLeao || activeReport === ReportType.NfseControl) && <FiscalReport reservations={allReservations} deposits={allDeposits} unifiedData={unifiedData} selectedYear={selectedYear} selectedMonth={selectedMonth} searchTerm={searchTerm} manualAdjustments={manualAdjustments} manualConciliations={manualConciliations} />}
                        {activeReport === ReportType.CashFlow && <CashFlowReport deposits={allDeposits} reservations={allReservations} unifiedData={unifiedData} manualAdjustments={manualAdjustments} selectedYear={selectedYear} selectedMonth={selectedMonth} searchTerm={searchTerm} carneLeaoData={carneLeaoData} manualConciliations={manualConciliations} />}
                        {activeReport === ReportType.YearlyCashFlow && <YearlyCashFlowReport deposits={allDeposits} reservations={allReservations} unifiedData={unifiedData} manualAdjustments={manualAdjustments} selectedYear={selectedYear} carneLeaoData={carneLeaoData} manualConciliations={manualConciliations} />}
                        {activeReport === ReportType.CashAccrualCompare && <CashAccrualCompareReport
                            reservations={allReservations}
                            deposits={allDeposits}
                            manualAdjustments={manualAdjustments}
                            manualConciliations={manualConciliations}
                            selectedYear={selectedYear}
                            selectedMonth={selectedMonth}
                            onJumpToManualConciliation={(reservationId) => {
                                setPendingManualConciliationReservationId(reservationId);
                                setActiveReport(ReportType.InteractiveCompensation);
                            }}
                        />}
                        {activeReport === ReportType.YearlyFinancialSummary && <YearlyFinancialSummaryReport reservations={allReservations} unifiedData={unifiedData} selectedYear={selectedYear} carneLeaoData={carneLeaoData} />}
                        {activeReport === ReportType.Calendar && <CalendarReport reservations={allReservations} selectedYear={selectedYear} selectedMonth={selectedMonth} />}
                        {activeReport === ReportType.FixedCosts && <FixedCostsReport unifiedData={unifiedData} selectedYear={selectedYear} />}
                        {activeReport === ReportType.Compensation && <CompensationReport reservations={allReservations} deposits={allDeposits} selectedYear={selectedYear} selectedMonth={selectedMonth} searchTerm={searchTerm} manualAdjustments={manualAdjustments} setManualAdjustments={setManualAdjustments} manualConciliations={manualConciliations} dismissedAutoMatches={dismissedAutoMatches} onDismissAutoMatch={handleDismissAutoMatch} unifiedData={unifiedData} />}
                        {activeReport === ReportType.InteractiveCompensation && <InteractiveCompensationReport
                            reservations={allReservations}
                            deposits={allDeposits}
                            manualAdjustments={manualAdjustments}
                            setManualAdjustments={setManualAdjustments}
                            manualConciliations={manualConciliations}
                            onSaveConciliations={c => saveManualConciliations(c).then(loadData)}
                            dismissedAutoMatches={dismissedAutoMatches}
                            onRestoreAutoMatch={handleRestoreAutoMatch}
                            initialSelectedReservationId={pendingManualConciliationReservationId}
                            onInitialSelectionConsumed={() => setPendingManualConciliationReservationId(null)}
                        />}
                        {activeReport === ReportType.DynamicPricing && <DynamicPricingReport reservations={allReservations} />}
                    </div>
                </main>
            </div>

            {/* Confirmation Modal */}
            {importConfirmation && importConfirmation.isOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full">
                        <h3 className="text-lg font-medium text-gray-900 mb-4">Confirmar Importação</h3>
                        <p className="text-sm text-gray-500 mb-6">{importConfirmation.message}</p>
                        
                        {importConfirmation.type !== 'reservations' && (
                            <>
                                <div className="flex space-x-4 mb-6">
                                    <div className="flex-1">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Mês a substituir</label>
                                        <select 
                                            value={importConfirmation.selectedMonth}
                                            onChange={(e) => setImportConfirmation({...importConfirmation, selectedMonth: Number(e.target.value)})}
                                            className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                        >
                                            {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                                                <option key={month} value={month}>{new Date(2000, month - 1, 1).toLocaleString('pt-BR', { month: 'long' })}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="flex-1">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Ano a substituir</label>
                                        <select 
                                            value={importConfirmation.selectedYear}
                                            onChange={(e) => setImportConfirmation({...importConfirmation, selectedYear: Number(e.target.value)})}
                                            className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                        >
                                            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(year => (
                                                <option key={year} value={year}>{year}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
                                    <div className="flex">
                                        <div className="ml-3">
                                            <p className="text-sm text-yellow-700">
                                                <strong>Atenção:</strong> Os dados de <strong>{new Date(2000, importConfirmation.selectedMonth - 1, 1).toLocaleString('pt-BR', { month: 'long' })}/{importConfirmation.selectedYear}</strong> que já existem no sistema serão apagados e substituídos por estes. Os demais meses permanecerão intactos.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}

                        <div className="flex justify-end space-x-3">
                            <button 
                                onClick={() => setImportConfirmation(null)}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                            >
                                Cancelar
                            </button>
                            <button 
                                onClick={confirmImport}
                                disabled={isUploading}
                                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 flex items-center"
                            >
                                {isUploading ? 'Importando...' : 'Confirmar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {manualDepositModal && (
                <ManualDepositModal
                    isOpen={manualDepositModal}
                    onClose={() => setManualDepositModal(false)}
                    onSave={handleManualDepositSave}
                    selectedMonth={selectedMonth}
                    selectedYear={selectedYear}
                    availableYears={availableYears}
                />
            )}

            {/* Alert Modal */}
            {alertMessage && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full">
                        <h3 className="text-lg font-medium text-gray-900 mb-4">Aviso</h3>
                        <p className="text-sm text-gray-500 mb-6">{alertMessage}</p>
                        <div className="flex justify-end">
                            <button 
                                onClick={() => setAlertMessage(null)}
                                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                            >
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
