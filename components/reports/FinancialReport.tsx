
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Reservation, FinancialData, CustomExpense, CleaningData, UnifiedData } from '../../types';
import { formatCurrency, getMonthName, formatDate, exportToExcel, sanitizePdfText } from '../../utils/helpers';
import { saveConfigData } from '../../services/dataService';
import { CONDOMINIO_201_FIXED, CONDOMINIO_202_FIXED } from '../../constants';
import { isFeesAsExpense, getRevenueLabel, getReservationRevenue } from '../../utils/feeMode';
import type { Chart, TooltipItem, ChartEvent, ActiveElement } from 'chart.js';

// Declare introJs to avoid TypeScript errors since it's loaded from a CDN
declare const introJs: any;

interface Props {
    reservations: Reservation[];
    unifiedData: UnifiedData;
    selectedYear: number;
    selectedMonth: number;
    searchTerm: string;
    onDataSave: (key: string, data: FinancialData) => void;
    carneLeaoData: { [year: number]: any[] };
}

const DataViewToggle: React.FC<{
    options: { value: string; label: string }[];
    currentValue: string;
    onToggle: (value: string) => void;
    disabled?: boolean;
    disabledTooltip?: string;
}> = ({ options, currentValue, onToggle, disabled, disabledTooltip }) => (
    <div className="flex rounded-md shadow-sm bg-slate-100 dark:bg-slate-700 p-1" title={disabled ? disabledTooltip : ''}>
        {options.map(opt => (
            <button
                key={opt.value}
                onClick={() => onToggle(opt.value)}
                className={`px-2 py-1 text-xs rounded ${currentValue === opt.value ? 'bg-white dark:bg-slate-600 shadow' : 'text-slate-600 dark:text-slate-300'} disabled:text-slate-400 disabled:cursor-not-allowed`}
                disabled={disabled}
            >
                {opt.label}
            </button>
        ))}
    </div>
);

const KpiCard: React.FC<{ title: string; value: string; className?: string; onClick?: () => void; tooltip?: string }> = ({ title, value, className = '', onClick, tooltip }) => (
    <div 
        className={`card p-4 transition-all duration-200 ${onClick ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:shadow-md' : ''}`}
        onClick={onClick}
        title={tooltip}
    >
        <h3 className="text-sm font-medium text-slate-500">{title}</h3>
        <p className={`text-2xl font-bold text-slate-800 dark:text-slate-100 ${className}`}>{value}</p>
    </div>
);

const ExpenseDetailsModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    details: Record<string, number>;
    deductibleDetails: Record<string, number>;
    monthName: string;
    year: number;
}> = ({ isOpen, onClose, details, deductibleDetails, monthName, year }) => {
    if (!isOpen) return null;

    const sortedDetails = (Object.entries(details) as [string, number][])
        .map(([k, v]) => [k, Number(v)] as [string, number])
        .filter((item: [string, number]) => item[1] > 0)
        .sort(([, a], [, b]) => b - a);

    const total = sortedDetails.reduce((sum, [, value]) => sum + value, 0);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-700 pb-3 mb-4">
                    <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Detalhamento das Despesas</h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white text-3xl font-light">&times;</button>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">Referente a: <span className="font-semibold">{monthName} / {year}</span></p>
                <div className="overflow-y-auto">
                    <table className="w-full">
                        <tbody>
                            {sortedDetails.map(([key, value]) => (
                                <React.Fragment key={key}>
                                    <tr className="border-b border-slate-200 dark:border-slate-700 last:border-b-0">
                                        <td className="py-3 px-2 text-slate-700 dark:text-slate-300">{key}</td>
                                        <td className="py-3 px-2 text-right text-slate-800 dark:text-slate-200 font-mono">{formatCurrency(value)}</td>
                                    </tr>
                                     {key === 'Despesas Dedutíveis' && Object.values(deductibleDetails).some((v: any) => (Number(v) || 0) > 0) && (
                                        <tr className="bg-slate-50 dark:bg-slate-700/50">
                                            <td colSpan={2} className="pt-1 pb-3 px-2">
                                                <div className="pl-6">
                                                    <ul className="space-y-1 text-sm">
                                                        {Object.entries(deductibleDetails)
                                                            .filter(([, itemValue]) => (itemValue as number) > 0)
                                                            .map(([itemKey, itemValue]) => (
                                                            <li key={itemKey} className="flex justify-between items-center">
                                                                <span className="text-slate-500 dark:text-slate-400">{itemKey}</span>
                                                                <span className="font-mono text-slate-600 dark:text-slate-300">{formatCurrency(itemValue as number)}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                        <tfoot className="sticky bottom-0 bg-white dark:bg-slate-800">
                            <tr className="border-t-2 border-slate-300 dark:border-slate-600">
                                <td className="py-3 px-2 font-bold text-slate-800 dark:text-slate-100">Total</td>
                                <td className="py-3 px-2 text-right font-bold text-slate-800 dark:text-slate-100 font-mono">{formatCurrency(total)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </div>
    );
};


const FinancialReport: React.FC<Props> = ({ reservations, unifiedData, selectedYear, selectedMonth, searchTerm, onDataSave, carneLeaoData }) => {
    const [selectedFlats, setSelectedFlats] = useState<string[]>(['201', '202']);
    const availableFlats = useMemo(() => ['201', '202', '301'], []);

    const [drillDownMonth, setDrillDownMonth] = useState<number | null>(null);
    const [flatRevenueView, setFlatRevenueView] = useState<'total' | 'adr'>('total');
    const [expandedChart, setExpandedChart] = useState<string | null>(null);
    const [showRevenueExpenseLegend, setShowRevenueExpenseLegend] = useState(false);
    
    // States for chart data views
    const [platformRevenueView, setPlatformRevenueView] = useState<'value' | 'percentage'>('value');
    const [flatRevenueDataView, setFlatRevenueDataView] = useState<'value' | 'percentage'>('value');
    const [revenueExpenseView, setRevenueExpenseView] = useState<'value' | 'percentage'>('value');
    const [cashFlowView, setCashFlowView] = useState<'value' | 'percentage'>('value');
    const [occupancyView, setOccupancyView] = useState<'percentage' | 'days'>('percentage');
    const [startFinancialTour, setStartFinancialTour] = useState(false);
    const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);

    useEffect(() => {
        setDrillDownMonth(null);
    }, [selectedFlats, selectedYear, selectedMonth]);

     useEffect(() => {
        if (startFinancialTour) {
            const intro = introJs();
            intro.setOptions({
                steps: [
                    {
                        title: 'Relatório Financeiro (Competência) 📈',
                        intro: 'Este relatório mostra o desempenho das suas reservas, independentemente de quando o pagamento caiu na conta. Ele foca na <strong>data da estadia</strong>.'
                    },
                    {
                        element: '[data-tour-financial="view-selector"]',
                        title: 'Filtre os Flats 🏢',
                        intro: 'Use este filtro para ver os resultados combinados (ex: Flats 201 e 202) ou isolados. Os números abaixo mudam instantaneamente.',
                        position: 'bottom'
                    },
                    {
                        element: '[data-tour-financial="kpis"]',
                        title: 'Indicadores Principais 💰',
                        intro: '<strong>Receita Bruta:</strong> Valor total das reservas do mês.<br/><strong>Despesas Totais:</strong> Soma das taxas, faxinas, condomínio, energia, etc.<br/><strong>Lucro Líquido:</strong> O que sobra no final.',
                        position: 'bottom'
                    },
                    {
                        element: '[data-tour-financial="details-table"]',
                        title: 'Lista de Reservas 🧾',
                        intro: 'Todas as estadias do mês selecionado estão aqui. Você vê quanto cada uma rendeu e quanto foi pago de taxa para a plataforma.',
                        position: 'left'
                    },
                    {
                        element: '[data-tour-financial="main-chart"]',
                        title: 'Receitas vs. Despesas 📊',
                        intro: 'Este gráfico compara o que entrou e o que saiu. A barra cinza mostra a média de despesas do ano para você saber se este mês está gastando mais que o normal.',
                        position: 'bottom'
                    },
                    {
                        element: '[data-tour-financial="cash-flow-chart"]',
                        title: 'Evolução do Ano 📅',
                        intro: 'Veja se o seu lucro está crescendo ou caindo ao longo dos meses. Clique em qualquer barra para ver os detalhes daquele mês específico.',
                        position: 'top'
                    },
                ],
                nextLabel: 'Próximo →',
                prevLabel: '← Anterior',
                doneLabel: 'Concluir',
                tooltipClass: 'custom-tooltip',
                exitOnOverlayClick: false,
                showProgress: true,
            });
            intro.oncomplete(() => setStartFinancialTour(false));
            intro.onexit(() => setStartFinancialTour(false));
            intro.start();
        }
    }, [startFinancialTour]);
    
    const monthlyReservations = useMemo(() => {
        return reservations
            .filter(r =>
                r.checkIn.getUTCFullYear() === selectedYear &&
                (selectedMonth === 0 || r.checkIn.getUTCMonth() + 1 === selectedMonth) &&
                selectedFlats.includes(r.flat)
            )
            .sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime());
    }, [reservations, selectedYear, selectedMonth, selectedFlats]);
    
    const reservationsForTable = useMemo(() => {
        let relevantReservations;
        if (drillDownMonth !== null) {
            relevantReservations = reservations.filter(r =>
                r.checkIn.getUTCFullYear() === selectedYear &&
                r.checkIn.getUTCMonth() + 1 === drillDownMonth &&
                selectedFlats.includes(r.flat)
            );
        } else {
            relevantReservations = monthlyReservations;
        }

        if (searchTerm) {
            const lowercasedFilter = searchTerm.toLowerCase();
            return relevantReservations.filter(r => 
                r.guestName.toLowerCase().includes(lowercasedFilter) ||
                r.flat.toLowerCase().includes(lowercasedFilter) ||
                formatDate(r.checkIn).includes(lowercasedFilter)
            );
        }
        return relevantReservations;
    }, [monthlyReservations, drillDownMonth, searchTerm, reservations, selectedYear, selectedFlats]);
    
    const cleaningCostData = useMemo(() => {
        const reservationsWithCheckoutInMonth = reservations.filter(r =>
            r.checkOut.getUTCFullYear() === selectedYear &&
            r.checkOut.getUTCMonth() + 1 === selectedMonth &&
            selectedFlats.includes(r.flat)
        );
        
        let totalCleaningReservationCost = 0;
        let totalGeneralServiceCost = 0;

        // Fetch Cleaning Config to get both per-reservation costs and general services
        const cleaningConfigKey = `cleaningConfig-${selectedYear}-${selectedMonth}`;
        const cleaningDataForMonth = unifiedData[cleaningConfigKey] as CleaningData;

        // 1. Calculate Reservation Specific Costs
        const cost201_202 = reservationsWithCheckoutInMonth.filter(r => ['201', '202'].includes(r.flat)).reduce((total, res) => {
            const entry = cleaningDataForMonth?.laundryEntries?.[res.id];
            const baseCleaningCost = res.flat === '202' ? 80 : 100;
            if (entry) {
                const laundryCost = (entry.laundryQty || 0) * 3;
                const extraLaundryCost = entry.hasExtraLaundry ? (entry.extraLaundryQty || 0) * 3 : 0;
                const extraCleaningCost = entry.hasExtraCleaning ? (entry.extraCleaningQty || 0) * baseCleaningCost : 0;
                return total + baseCleaningCost + laundryCost + extraLaundryCost + extraCleaningCost;
            } else {
                const defaultLaundryQty = res.flat === '202' ? 15 : 25;
                const laundryCost = defaultLaundryQty * 3;
                return total + baseCleaningCost + laundryCost;
            }
        }, 0);

        const cost301 = reservationsWithCheckoutInMonth.filter(r => r.flat === '301').length * (100 + (25 * 3));
        totalCleaningReservationCost = cost201_202 + cost301;

        // 2. Calculate General Services (Maintenance/Extras)
        if (cleaningDataForMonth?.generalServices) {
            totalGeneralServiceCost = cleaningDataForMonth.generalServices
                .filter(s => {
                    if (s.flat === 'Geral') return true; // Include 'Geral' if any flat is selected? Or maybe strictly? Let's include if intersection.
                    // If flat is specific, check if it's in selectedFlats
                    return selectedFlats.includes(s.flat);
                })
                .reduce((sum, s) => sum + s.value, 0);
        }

        return {
            totalCleaning: totalCleaningReservationCost,
            totalGeneralServices: totalGeneralServiceCost
        };

    }, [unifiedData, reservations, selectedYear, selectedMonth, selectedFlats]);

     const { grossRevenue, totalFees, totalDeductibleExpenses, totalOtherExpenses, totalCustomExpenses, totalExpenses, netProfit, expenseDetails, deductibleDetails, revenueByPlatform, reservationsByPlatform, revenueAndAdrByFlat } = useMemo(() => {
        const feesAreExpense = isFeesAsExpense(selectedYear);
        // Receita: a partir de 2026, já líquida das taxas (netEarnings).
        // Até 2025: bruta (grossEarnings) — taxas viram linha de despesa abaixo.
        const grossRev = monthlyReservations.reduce((sum, r) => sum + getReservationRevenue(r, selectedYear), 0);
        const fees = monthlyReservations.reduce((sum, r) => sum + r.fees, 0);

        let dedExpenses = 0;
        let otherExp = 0;
        let customExp = 0;
        const dedDetails: Record<string, number> = {};

        // 201/202 Expenses
        if (selectedFlats.includes('201') || selectedFlats.includes('202')) {
            const data = unifiedData[`financialConfig-${selectedYear}-${selectedMonth}`] as FinancialData;

            if (data) {
                const de = data.deductibleExpenses || {};
                if (selectedFlats.includes('201')) {
                    dedDetails['Condomínio 201'] = de.condominio || 0;
                    dedDetails['Taxa Extra 201'] = de.taxaExtra || 0;
                    dedDetails['Energia 201'] = de.energia || 0;
                    dedDetails['IPTU 201'] = de.iptu || 0;
                    dedExpenses += (de.condominio || 0) + (de.taxaExtra || 0) + (de.energia || 0) + (de.iptu || 0);
                }
                if (selectedFlats.includes('202')) {
                    dedDetails['Condomínio 202'] = de.condominio202 || 0;
                    dedDetails['Taxa Extra 202'] = de.taxaExtra202 || 0;
                    dedDetails['Energia 202'] = de.energia202 || 0;
                    dedDetails['IPTU 202'] = de.iptu202 || 0;
                    dedExpenses += (de.condominio202 || 0) + (de.taxaExtra202 || 0) + (de.energia202 || 0) + (de.iptu202 || 0);
                }
                
                const otherVarExp = { ...data.otherExpenses };
                if (otherVarExp.mensalidadeStays) {
                    otherExp += otherVarExp.mensalidadeStays;
                    delete otherVarExp.mensalidadeStays;
                }
                otherExp += (Object.values(otherVarExp) as number[]).reduce((s, v) => s + (Number(v) || 0), 0);
                
                customExp += (data.customExpenses || []).reduce((s, exp) => s + (Number(exp.value) || 0), 0);
            } else {
                // Defaults if no data saved
                if (selectedFlats.includes('201')) {
                    dedExpenses += CONDOMINIO_201_FIXED;
                    dedDetails['Condomínio 201'] = CONDOMINIO_201_FIXED;
                }
                if (selectedFlats.includes('202')) {
                    dedExpenses += CONDOMINIO_202_FIXED;
                     dedDetails['Condomínio 202'] = CONDOMINIO_202_FIXED;
                }
                otherExp += 250;
            }
        }

        // 301 Expenses
        if (selectedFlats.includes('301')) {
            const data = unifiedData[`financialConfig301-${selectedYear}-${selectedMonth}`] as FinancialData;
            
            // Add Stays fee only if it hasn't been added from the 201/202 block.
            if (!selectedFlats.includes('201') && !selectedFlats.includes('202')) {
                const staysVal = data?.otherExpenses?.['mensalidadeStays'];
                const staysValNum = (staysVal !== undefined && typeof staysVal === 'number') ? staysVal : 250;
                otherExp += staysValNum;
            }

            if (data) {
                const de = data.deductibleExpenses || {};
                dedDetails['Condomínio 301'] = de.condominio || 0;
                dedDetails['Taxa Extra 301'] = de.taxaExtra || 0;
                dedDetails['Energia 301'] = de.energia || 0;
                dedDetails['IPTU 301'] = de.iptu || 0;

                dedExpenses += (Object.values(de || {}) as number[]).reduce((s: number, v: number) => s + (Number(v) || 0), 0);
                const otherVariableExpenses = { ...data.otherExpenses };
                delete otherVariableExpenses.mensalidadeStays;
                otherExp += (Object.values(otherVariableExpenses) as number[]).reduce((s: number, v: number) => s + (Number(v) || 0), 0);
                customExp += (data.customExpenses || []).reduce((s: number, exp: any) => s + (Number(exp.value) || 0), 0);
            }
        }
        
        let carneLeaoTaxFromPrevMonth = 0;
        // O imposto do carnê leão aplica-se apenas aos rendimentos dos flats 201 e 202.
        if (selectedFlats.includes('201') || selectedFlats.includes('202')) {
            let prevMonthTaxYear = selectedYear;
            let prevMonth = selectedMonth - 1;
            if (selectedMonth === 1) {
                prevMonthTaxYear = selectedYear - 1;
                prevMonth = 12;
            }
            carneLeaoTaxFromPrevMonth = carneLeaoData[prevMonthTaxYear]?.find(d => d.month === prevMonth)?.taxDue || 0;
        }

        const totalExp = (feesAreExpense ? fees : 0) + cleaningCostData.totalCleaning + dedExpenses + otherExp + customExp + carneLeaoTaxFromPrevMonth + cleaningCostData.totalGeneralServices;
        // Fix: Use local 'grossRev' instead of 'grossRevenue' which is part of the return object being constructed
        const profit = grossRev - totalExp; 

        const revByPlatform = monthlyReservations.reduce((acc, res) => {
            acc[res.platform] = (acc[res.platform] || 0) + getReservationRevenue(res, selectedYear);
            return acc;
        }, {} as Record<string, number>);

        const resByPlatform = monthlyReservations.reduce((acc, res) => {
            acc[res.platform] = (acc[res.platform] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const dataByFlat = monthlyReservations.reduce((acc, res) => {
            if (!acc[res.flat]) {
                acc[res.flat] = { revenue: 0, nights: 0 };
            }
            acc[res.flat].revenue += getReservationRevenue(res, selectedYear);
            const nights = (res.checkOut.getTime() - res.checkIn.getTime()) / (1000 * 60 * 60 * 24);
            acc[res.flat].nights += nights > 0 ? nights : 0;
            return acc;
        }, {} as Record<string, { revenue: number, nights: number }>);
        const revAndAdrByFlat: Record<string, { total: number, adr: number }> = {};
        for (const flat in dataByFlat) {
            const { revenue, nights } = dataByFlat[flat];
            revAndAdrByFlat[flat] = {
                total: revenue,
                adr: nights > 0 ? revenue / nights : 0
            };
        }
        
        const expDetails: Record<string, number> = {};
        if (feesAreExpense) {
            // Até 2025: taxas aparecem como primeira linha de despesa
            expDetails['Taxas de Plataforma'] = fees;
        }
        // 2026+: taxas não entram aqui — receita já vem líquida delas
        expDetails['Faxina/Lavanderia'] = cleaningCostData.totalCleaning;
        expDetails['Despesas Dedutíveis'] = dedExpenses;
        expDetails['Outras Despesas'] = otherExp;
        expDetails['Despesas Customizadas'] = customExp;
        
        if (cleaningCostData.totalGeneralServices > 0) {
            expDetails['Manutenção/Extras (Lavanderia)'] = cleaningCostData.totalGeneralServices;
        }
        
        if (carneLeaoTaxFromPrevMonth > 0) {
            expDetails['Imposto Carnê Leão (Mês Ant.)'] = carneLeaoTaxFromPrevMonth;
        }
        
        return { grossRevenue: grossRev, totalFees: fees, totalDeductibleExpenses: dedExpenses, totalOtherExpenses: otherExp, totalCustomExpenses: customExp, totalExpenses: totalExp, netProfit: profit, expenseDetails: expDetails, deductibleDetails: dedDetails, revenueByPlatform: revByPlatform, reservationsByPlatform: resByPlatform, revenueAndAdrByFlat: revAndAdrByFlat };

    }, [monthlyReservations, unifiedData, selectedYear, selectedMonth, selectedFlats, cleaningCostData, carneLeaoData]);
    
    const profitMargin = useMemo(() => {
        return grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;
    }, [grossRevenue, netProfit]);

    const getOccupancyForYear = useCallback((year: number) => {
        const numFlats = selectedFlats.length;
        if (numFlats === 0) {
            return Array.from({ length: 12 }, (_, i) => ({ month: i + 1, occupancyRate: 0, totalOccupiedDays: 0 }));
        }

        return Array.from({ length: 12 }, (_, i) => {
            const month = i + 1;
            const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
            const totalAvailableDays = daysInMonth * numFlats;

            const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
            const endOfMonth = new Date(Date.UTC(year, month, 1));

            const totalOccupiedDays = reservations
                .filter(r => selectedFlats.includes(r.flat) && r.checkIn < endOfMonth && r.checkOut > startOfMonth)
                .reduce((sum, r) => {
                    const effectiveStart = Math.max(r.checkIn.getTime(), startOfMonth.getTime());
                    const effectiveEnd = Math.min(r.checkOut.getTime(), endOfMonth.getTime());
                    const nightsInMonth = (effectiveEnd - effectiveStart) / (1000 * 60 * 60 * 24);
                    return sum + (nightsInMonth > 0 ? nightsInMonth : 0);
                }, 0);
            
            const occupancyRate = totalAvailableDays > 0 ? (totalOccupiedDays / totalAvailableDays) * 100 : 0;

            return { month, occupancyRate, totalOccupiedDays };
        });
    }, [reservations, selectedFlats]);

    const yearlyOccupancy = useMemo(() => getOccupancyForYear(selectedYear), [getOccupancyForYear, selectedYear]);
    const lastYearOccupancy = useMemo(() => getOccupancyForYear(selectedYear - 1), [getOccupancyForYear, selectedYear]);

    const currentMonthOccupancy = useMemo(() => {
        return yearlyOccupancy[selectedMonth - 1]?.occupancyRate || 0;
    }, [yearlyOccupancy, selectedMonth]);
    
    const tableTotals = useMemo(() => {
        return reservationsForTable.reduce((acc, r) => {
            acc.fees += r.fees;
            acc.netEarnings += r.netEarnings;
            return acc;
        }, { fees: 0, netEarnings: 0 });
    }, [reservationsForTable]);

    const chartRef = useRef<HTMLCanvasElement>(null);
    const chartInstance = useRef<Chart | null>(null);
    const expandedChartCanvasRef = useRef<HTMLCanvasElement>(null);
    const expandedChartInstance = useRef<Chart | null>(null);
    const cashFlowChartRef = useRef<HTMLCanvasElement>(null);
    const cashFlowChartInstance = useRef<Chart | null>(null);
    const platformRevenueChartRef = useRef<HTMLCanvasElement>(null);
    const platformRevenueChartInstance = useRef<Chart | null>(null);
    const flatRevenueChartRef = useRef<HTMLCanvasElement>(null);
    const flatRevenueChartInstance = useRef<Chart | null>(null);
    const occupancyChartRef = useRef<HTMLCanvasElement>(null);
    const occupancyChartInstance = useRef<Chart | null>(null);


    const yearlyFinancials = useMemo(() => {
        return Array.from({ length: 12 }, (_, i) => {
            const month = i + 1;
            const monthlyReservationsForRevenue = reservations.filter(r =>
                r.checkIn.getUTCFullYear() === selectedYear &&
                r.checkIn.getUTCMonth() + 1 === month &&
                selectedFlats.includes(r.flat)
            );
            const grossRevenue = monthlyReservationsForRevenue.reduce((sum, r) => sum + getReservationRevenue(r, selectedYear), 0);
            const totalFees = monthlyReservationsForRevenue.reduce((sum, r) => sum + r.fees, 0);
            const reservationsWithCheckoutInMonth = reservations.filter(r =>
                r.checkOut.getUTCFullYear() === selectedYear &&
                r.checkOut.getUTCMonth() + 1 === month &&
                selectedFlats.includes(r.flat)
            );

            // Clean cost + General Services
            let totalGeneralServicesCost = 0;
            const cleaningConfigKey = `cleaningConfig-${selectedYear}-${month}`;
            const cleaningDataForMonth = unifiedData[cleaningConfigKey] as CleaningData;

            const cleaningCost201_202 = reservationsWithCheckoutInMonth.filter(r => ['201', '202'].includes(r.flat)).reduce((total, res) => {
                 const entry = cleaningDataForMonth?.laundryEntries?.[res.id];
                 const baseCleaningCost = res.flat === '202' ? 80 : 100;
                 if (entry) {
                     const laundryCost = (entry.laundryQty || 0) * 3;
                     const extraLaundryCost = entry.hasExtraLaundry ? (entry.extraLaundryQty || 0) * 3 : 0;
                     const extraCleaningCost = entry.hasExtraCleaning ? (entry.extraCleaningQty || 0) * baseCleaningCost : 0;
                     return total + baseCleaningCost + laundryCost + extraLaundryCost + extraCleaningCost;
                 } else {
                     const defaultLaundryQty = res.flat === '202' ? 15 : 25;
                     const laundryCost = defaultLaundryQty * 3;
                     return total + baseCleaningCost + laundryCost;
                 }
             }, 0);

            const cleaningCost301 = reservationsWithCheckoutInMonth.filter(r => r.flat === '301').length * (100 + (25 * 3));
            
            if (cleaningDataForMonth?.generalServices) {
                totalGeneralServicesCost = cleaningDataForMonth.generalServices
                    .filter(s => selectedFlats.includes(s.flat) || s.flat === 'Geral')
                    .reduce((sum, s) => sum + s.value, 0);
            }

            const cleaningCost = cleaningCost201_202 + cleaningCost301 + totalGeneralServicesCost;

            let deductible = 0;
            let other = 0;
            let custom = 0;

            if (selectedFlats.includes('201') || selectedFlats.includes('202')) {
                const financialConfigKey = `financialConfig-${selectedYear}-${month}`;
                const financialDataForMonth = unifiedData[financialConfigKey] as FinancialData;
                if (financialDataForMonth) {
                    const de = financialDataForMonth.deductibleExpenses || {};
                    if (selectedFlats.includes('201')) deductible += (de.condominio || 0) + (de.taxaExtra || 0) + (de.energia || 0) + (de.iptu || 0);
                    if (selectedFlats.includes('202')) deductible += (de.condominio202 || 0) + (de.taxaExtra202 || 0) + (de.energia202 || 0) + (de.iptu202 || 0);
                    other += financialDataForMonth.otherExpenses?.mensalidadeStays || 0;
                    custom += (financialDataForMonth.customExpenses || []).reduce((s, exp) => s + (Number(exp.value) || 0), 0);
                } else {
                    if (selectedFlats.includes('201')) deductible += CONDOMINIO_201_FIXED;
                    if (selectedFlats.includes('202')) deductible += CONDOMINIO_202_FIXED;
                    other += 250;
                }
            }
             if (selectedFlats.includes('301')) {
                const financialConfigKey301 = `financialConfig301-${selectedYear}-${month}`;
                const financialData301 = unifiedData[financialConfigKey301] as FinancialData;
                other += 250; // Always add fixed expense
                if (financialData301) {
                    deductible += (Object.values(financialData301.deductibleExpenses || {}) as number[]).reduce((s: number, v: number) => s + (Number(v) || 0), 0);
                    const otherVariableExpenses = { ...financialData301.otherExpenses };
                    delete otherVariableExpenses.mensalidadeStays;
                    other += (Object.values(otherVariableExpenses) as number[]).reduce((s: number, v: number) => s + (Number(v) || 0), 0);
                    custom += (financialData301.customExpenses || []).reduce((s: number, exp: any) => s + (Number(exp.value) || 0), 0);
                }
            }

            let carneLeaoTaxFromPrevMonth = 0;
            // O imposto do carnê leão aplica-se apenas aos rendimentos dos flats 201 e 202.
            if (selectedFlats.includes('201') || selectedFlats.includes('202')) {
                let prevMonthTaxYear = selectedYear;
                let prevTaxMonth = month - 1;
                if (month === 1) {
                    prevMonthTaxYear = selectedYear - 1;
                    prevTaxMonth = 12;
                }
                carneLeaoTaxFromPrevMonth = carneLeaoData[prevMonthTaxYear]?.find(d => d.month === prevTaxMonth)?.taxDue || 0;
            }

            const totalExpenses = (isFeesAsExpense(selectedYear) ? totalFees : 0) + cleaningCost + deductible + other + custom + carneLeaoTaxFromPrevMonth;
            const cashFlow = grossRevenue - totalExpenses;
            const profitMargin = grossRevenue > 0 ? (cashFlow / grossRevenue) * 100 : 0;
            return { month, grossRevenue, totalExpenses, cashFlow, profitMargin };
        });
    }, [reservations, unifiedData, selectedYear, selectedFlats, carneLeaoData]);

    const cashFlowChartData = useMemo(() => {
        return yearlyFinancials.map(f => cashFlowView === 'value' ? f.cashFlow : f.profitMargin);
    }, [yearlyFinancials, cashFlowView]);

    const cashFlowMovingAverage = useMemo(() => {
        const data = cashFlowChartData;
        const movingAverage = [];
        for (let i = 0; i < data.length; i++) {
            if (i < 2) {
                movingAverage.push(null); // Not enough data for a 3-month average
            } else {
                const sum = data[i] + data[i - 1] + data[i - 2];
                movingAverage.push(sum / 3);
            }
        }
        return movingAverage;
    }, [cashFlowChartData]);

    const averageYearlyExpense = useMemo(() => {
        const monthsWithData = yearlyFinancials.filter(f => f.grossRevenue > 0 || f.totalExpenses > 0);
        if (monthsWithData.length === 0) return 0;
        const totalYearlyExpenses = monthsWithData.reduce((sum, f) => sum + f.totalExpenses, 0);
        return totalYearlyExpenses / monthsWithData.length;
    }, [yearlyFinancials]);

    const averageYearlyExpensePercentage = useMemo(() => {
        const monthlyPercentages = yearlyFinancials
            .map(f => f.grossRevenue > 0 ? (f.totalExpenses / f.grossRevenue) * 100 : null)
            .filter((p): p is number => p !== null);
        if (monthlyPercentages.length === 0) return 0;
        const sumOfPercentages = monthlyPercentages.reduce((sum, p) => sum + p, 0);
        return sumOfPercentages / monthlyPercentages.length;
    }, [yearlyFinancials]);


    useEffect(() => {
        if (chartRef.current) {
            if (chartInstance.current) chartInstance.current.destroy();
            const ctx = chartRef.current.getContext('2d');
            if (ctx) {
                const labels = ['Receitas', 'Despesas (Mês)', `Média Desp. (${selectedYear})`];
                
                const feesAsExp = isFeesAsExpense(selectedYear);
                const datasets: any[] = [
                    { label: 'Receitas', data: [grossRevenue, 0, 0], backgroundColor: '#10b981', borderRadius: 4 }, // Emerald-500
                ];
                if (feesAsExp) {
                    datasets.push({ label: 'Taxas', data: [0, expenseDetails['Taxas de Plataforma'] || 0, 0], backgroundColor: '#f43f5e', stack: 'despesas', borderRadius: 4 }); // Rose-500
                }
                datasets.push(
                    { label: 'Faxina', data: [0, expenseDetails['Faxina/Lavanderia'], 0], backgroundColor: '#f59e0b', stack: 'despesas', borderRadius: 4 }, // Amber-500
                    { label: 'Manutenção/Extras', data: [0, expenseDetails['Manutenção/Extras (Lavanderia)'] || 0, 0], backgroundColor: '#8b5cf6', stack: 'despesas', borderRadius: 4 }, // Violet-500
                    { label: 'Imposto Carnê Leão', data: [0, expenseDetails['Imposto Carnê Leão (Mês Ant.)'] || 0, 0], backgroundColor: '#64748b', stack: 'despesas', borderRadius: 4 }, // Slate-500
                    { label: 'Dedutíveis', data: [0, expenseDetails['Despesas Dedutíveis'], 0], backgroundColor: '#3b82f6', stack: 'despesas', borderRadius: 4 }, // Blue-500
                    { label: 'Outras', data: [0, expenseDetails['Outras Despesas'], 0], backgroundColor: '#06b6d4', stack: 'despesas', borderRadius: 4 }, // Cyan-500
                    { label: 'Customizadas', data: [0, expenseDetails['Despesas Customizadas'], 0], backgroundColor: '#ec4899', stack: 'despesas', borderRadius: 4 }, // Pink-500
                    { label: 'Média Despesas', data: [0, 0, averageYearlyExpense], backgroundColor: '#cbd5e1', borderRadius: 4 } // Slate-300
                );

                chartInstance.current = new (window as any).Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels,
                        datasets
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: { 
                            x: { stacked: true, grid: { display: false }, border: { display: false } },
                            y: { stacked: true, beginAtZero: true, grid: { color: '#f1f5f9', drawBorder: false }, border: { display: false }, ticks: { callback: (value) => formatCurrency(Number(value)), color: '#94a3b8', font: { size: 11 } } }
                        },
                        plugins: {
                            legend: {
                                display: false,
                            },
                            tooltip: {
                                backgroundColor: '#1e293b',
                                padding: 12,
                                cornerRadius: 8,
                                callbacks: {
                                    label: (context: TooltipItem<'bar'>) => {
                                        const label = context.dataset.label || '';
                                        const value = Number(context.parsed.y);
                                        if (value === null || value === 0) return '';
                                        if (revenueExpenseView === 'percentage' && label !== 'Receitas' && label !== 'Média Despesas') {
                                            const percentage = grossRevenue > 0 ? ((value / grossRevenue) * 100).toFixed(1) : '0.0';
                                            return `${label}: ${formatCurrency(value)} (${percentage}%)`;
                                        }
                                        return `${label}: ${formatCurrency(value)}`;
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }
        return () => chartInstance.current?.destroy();
     
    }, [grossRevenue, averageYearlyExpense, expenseDetails, selectedYear, revenueExpenseView]);
    
    useEffect(() => {
        if (chartInstance.current) {
            chartInstance.current.options.plugins.legend.display = showRevenueExpenseLegend;
            chartInstance.current.update('none');
        }
    }, [showRevenueExpenseLegend]);

    useEffect(() => {
        if (expandedChart && expandedChartCanvasRef.current) {
            if (expandedChartInstance.current) {
                expandedChartInstance.current.destroy();
            }
            const ctx = expandedChartCanvasRef.current.getContext('2d');
            if (!ctx) return;
            
            let chartConfig: any = {};
            
            switch(expandedChart) {
                case 'revenueExpense': {
                    const feesAsExpExp = isFeesAsExpense(selectedYear);
                    const expandedDatasets: any[] = [
                        { label: 'Receitas', data: [grossRevenue, 0, 0], backgroundColor: '#10b981', borderRadius: 4 },
                    ];
                    if (feesAsExpExp) {
                        expandedDatasets.push({ label: 'Taxas', data: [0, expenseDetails['Taxas de Plataforma'] || 0, 0], backgroundColor: '#f43f5e', stack: 'despesas', borderRadius: 4 });
                    }
                    expandedDatasets.push(
                        { label: 'Faxina', data: [0, expenseDetails['Faxina/Lavanderia'], 0], backgroundColor: '#f59e0b', stack: 'despesas', borderRadius: 4 },
                        { label: 'Manutenção/Extras', data: [0, expenseDetails['Manutenção/Extras (Lavanderia)'] || 0, 0], backgroundColor: '#8b5cf6', stack: 'despesas', borderRadius: 4 },
                        { label: 'Imposto Carnê Leão', data: [0, expenseDetails['Imposto Carnê Leão (Mês Ant.)'] || 0, 0], backgroundColor: '#64748b', stack: 'despesas', borderRadius: 4 },
                        { label: 'Dedutíveis', data: [0, expenseDetails['Despesas Dedutíveis'], 0], backgroundColor: '#3b82f6', stack: 'despesas', borderRadius: 4 },
                        { label: 'Outras', data: [0, expenseDetails['Outras Despesas'], 0], backgroundColor: '#06b6d4', stack: 'despesas', borderRadius: 4 },
                        { label: 'Customizadas', data: [0, expenseDetails['Despesas Customizadas'], 0], backgroundColor: '#ec4899', stack: 'despesas', borderRadius: 4 },
                        { label: 'Média Despesas', data: [0, 0, averageYearlyExpense], backgroundColor: '#cbd5e1', borderRadius: 4 }
                    );
                    chartConfig = {
                        type: 'bar',
                        data: {
                            labels: ['Receitas', 'Despesas (Mês)', `Média Desp. (${selectedYear})`],
                            datasets: expandedDatasets
                        },
                        options: {
                            responsive: true, maintainAspectRatio: false,
                            scales: { 
                                x: { stacked: true, grid: { display: false }, border: { display: false } }, 
                                y: { stacked: true, beginAtZero: true, grid: { color: '#f1f5f9', drawBorder: false }, border: { display: false }, ticks: { callback: (value) => formatCurrency(Number(value)), color: '#94a3b8', font: { size: 11 } } } 
                            },
                            plugins: { legend: { display: true, position: 'top', labels: { usePointStyle: true, boxWidth: 8 } } }
                        }
                    };
                    break;
                }
                case 'platformRevenue': {
                    const platformLabels = Object.keys(revenueByPlatform);
                    const platformData = Object.values(revenueByPlatform);
                    chartConfig = {
                        type: 'doughnut',
                        data: {
                            labels: platformLabels,
                            datasets: [{
                                data: platformData,
                                backgroundColor: platformLabels.map(l => ({ 'BOOKING': '#3b82f6', 'AIRBNB': '#f43f5e', 'DECOLAR': '#f97316', 'Particular': '#9ca3af' }[l] || '#a3a3af')),
                                hoverOffset: 4,
                                borderWidth: 0,
                                borderRadius: 4
                            }]
                        },
                        options: {
                            responsive: true, maintainAspectRatio: false, cutout: '70%',
                            plugins: { legend: { position: 'right', labels: { usePointStyle: true, boxWidth: 8 } } },
                            layout: { padding: 20 }
                        }
                    };
                    break;
                }
                 case 'flatRevenue': {
                    const flatLabels = Object.keys(revenueAndAdrByFlat);
                    const flatValues = flatLabels.map(l => flatRevenueView === 'adr' ? revenueAndAdrByFlat[l].adr : revenueAndAdrByFlat[l].total);
                     chartConfig = {
                         type: 'bar',
                         data: {
                             labels: flatLabels,
                             datasets: [{
                                 label: flatRevenueView === 'total' ? 'Receita Total' : 'Diária Média (ADR)',
                                 data: flatValues,
                                 backgroundColor: flatLabels.map(l => ({ '201': '#10b981', '202': '#f59e0b', '301': '#8b5cf6' }[l] || '#a3a3a3')),
                                 borderRadius: 4
                             }]
                         },
                         options: {
                             responsive: true, maintainAspectRatio: false,
                             scales: { 
                                 x: { grid: { display: false }, border: { display: false } },
                                 y: { grid: { color: '#f1f5f9', drawBorder: false }, border: { display: false }, ticks: { callback: (value) => formatCurrency(Number(value)), color: '#94a3b8', font: { size: 11 } } } 
                             },
                             plugins: { legend: { display: false } }
                         }
                     };
                     break;
                 }
                case 'cashFlow': {
                    const cashFlowMonthLabels = Array.from({ length: 12 }, (_, i) => getMonthName(i + 1));
                    chartConfig = {
                        type: 'bar',
                        data: {
                            labels: cashFlowMonthLabels,
                            datasets: [
                                { label: 'Fluxo de Caixa', data: cashFlowChartData, backgroundColor: cashFlowChartData.map(v => v >= 0 ? '#10b981' : '#ef4444'), borderRadius: 4, order: 2 },
                                { type: 'line', label: 'Média Móvel (3 meses)', data: cashFlowMovingAverage, borderColor: '#f97316', borderWidth: 2, fill: false, tension: 0.4, pointRadius: 0, order: 1 }
                            ]
                        },
                        options: { 
                            responsive: true, maintainAspectRatio: false, 
                            scales: { 
                                x: { grid: { display: false }, border: { display: false } },
                                y: { beginAtZero: true, grid: { color: '#f1f5f9', drawBorder: false }, border: { display: false }, ticks: { callback: (value) => formatCurrency(Number(value)), color: '#94a3b8', font: { size: 11 } } } 
                            }, 
                            plugins: { legend: { display: true, position: 'top', labels: { usePointStyle: true, boxWidth: 8 } } } 
                        }
                    };
                    break;
                }
                case 'occupancy': {
                    const occupancyMonthLabels = Array.from({ length: 12 }, (_, i) => getMonthName(i + 1));
                    chartConfig = {
                        type: 'line',
                        data: {
                            labels: occupancyMonthLabels,
                            datasets: [
                                { label: `${selectedYear - 1}`, data: lastYearOccupancy.map(d => occupancyView === 'percentage' ? d.occupancyRate : d.totalOccupiedDays), borderColor: '#94a3b8', borderDash: [5, 5], borderWidth: 2, fill: false, tension: 0.4, pointRadius: 0 },
                                { label: `${selectedYear}`, data: yearlyOccupancy.map(d => occupancyView === 'percentage' ? d.occupancyRate : d.totalOccupiedDays), borderColor: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.1)', borderWidth: 2, fill: true, tension: 0.4, pointRadius: 3, pointBackgroundColor: '#fff', pointBorderColor: '#8b5cf6' }
                            ]
                        },
                        options: { 
                            responsive: true, maintainAspectRatio: false, 
                            scales: { 
                                x: { grid: { display: false }, border: { display: false } },
                                y: { beginAtZero: true, grid: { color: '#f1f5f9', drawBorder: false }, border: { display: false }, max: occupancyView === 'percentage' ? 100 : undefined, ticks: { callback: (value) => occupancyView === 'percentage' ? `${value}%` : `${value} dias`, color: '#94a3b8', font: { size: 11 } } } 
                            }, 
                            plugins: { legend: { display: true, position: 'top', labels: { usePointStyle: true, boxWidth: 8 } } } 
                        }
                    };
                    break;
                }
            }

            if (chartConfig.type) {
                expandedChartInstance.current = new (window as any).Chart(ctx, chartConfig);
            }
        }
        return () => {
            if (expandedChartInstance.current) {
                expandedChartInstance.current.destroy();
                expandedChartInstance.current = null;
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [expandedChart]);

    useEffect(() => {
        if (cashFlowChartRef.current) {
            if (cashFlowChartInstance.current) cashFlowChartInstance.current.destroy();
            const ctx = cashFlowChartRef.current.getContext('2d');
            if (ctx) {
                const monthLabels = Array.from({ length: 12 }, (_, i) => getMonthName(i + 1).substring(0, 3));
                cashFlowChartInstance.current = new (window as any).Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: monthLabels,
                        datasets: [
                            {
                                label: cashFlowView === 'value' ? 'Fluxo de Caixa' : 'Margem de Lucro',
                                data: cashFlowChartData,
                                backgroundColor: cashFlowChartData.map(v => v >= 0 ? 'rgba(75, 192, 192, 0.6)' : 'rgba(255, 99, 132, 0.6)'),
                                borderColor: cashFlowChartData.map(v => v >= 0 ? 'rgba(75, 192, 192, 1)' : 'rgba(255, 99, 132, 1)'),
                                borderWidth: 1,
                                order: 2
                            },
                            {
                                type: 'line',
                                label: 'Média Móvel (3 meses)',
                                data: cashFlowMovingAverage,
                                borderColor: 'rgba(255, 159, 64, 1)',
                                backgroundColor: 'rgba(255, 159, 64, 0.5)',
                                borderWidth: 2,
                                fill: false,
                                tension: 0.4,
                                pointRadius: 0,
                                order: 1,
                            }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        onClick: (event: ChartEvent, elements: ActiveElement[]) => {
                            if (elements.length > 0) {
                                const elementIndex = elements[0].index;
                                const clickedMonth = elementIndex + 1;
                                setDrillDownMonth(clickedMonth);
                            }
                        },
                        scales: { y: { beginAtZero: true, ticks: { 
                            callback: (value: string | number) => cashFlowView === 'percentage' ? `${Number(value).toFixed(0)}%` : formatCurrency(Number(value)) 
                        } } },
                        plugins: {
                            tooltip: { callbacks: { label: (context: TooltipItem<'bar' | 'line'>) => {
                                const label = context.dataset.label || '';
                                const value = Number(context.parsed.y);
                                if (value === null) return '';
                                return `${label}: ${cashFlowView === 'percentage' ? `${value.toFixed(1)}%` : formatCurrency(value)}`;
                            } } }
                        }
                    }
                });
            }
        }
        return () => cashFlowChartInstance.current?.destroy();
    }, [cashFlowChartData, cashFlowMovingAverage, cashFlowView]);

    useEffect(() => {
        if (platformRevenueChartRef.current) {
            if (platformRevenueChartInstance.current) platformRevenueChartInstance.current.destroy();
            const ctx = platformRevenueChartRef.current.getContext('2d');
            if (ctx && Object.keys(revenueByPlatform).length > 0) {
                 const platformColorMap: { [key: string]: string } = { 'BOOKING': '#60a5fa', 'AIRBNB': '#f87171', 'DECOLAR': '#f97316', 'Particular': '#9ca3af' };
                 const labels = Object.keys(revenueByPlatform);
                 // FIX: Cast Object.values to number[] to fix TS errors with reduce and formatCurrency
                 const data = Object.values(revenueByPlatform) as number[];
                 
                 const centerTextPlugin = {
                     id: 'doughnutCenterText',
                     afterDraw: (chart: Chart) => {
                         const { ctx, _active } = chart;
                         const chartArea = chart.chartArea;
                         if (!chartArea) return;

                         ctx.save();
                         const centerX = (chartArea.left + chartArea.right) / 2;
                         const centerY = (chartArea.top + chartArea.bottom) / 2;

                         ctx.textAlign = 'center';
                         ctx.textBaseline = 'middle';
                         
                         let text1, text2;

                         if (_active && _active.length > 0) {
                             const activeIndex = _active[0].index;
                             text1 = labels[activeIndex];
                             text2 = formatCurrency(data[activeIndex]);
                         } else {
                             const total = data.reduce((sum, val) => sum + val, 0);
                             text1 = 'Receita Total';
                             text2 = formatCurrency(total);
                         }

                         ctx.font = '1rem sans-serif';
                         ctx.fillStyle = '#6b7280';
                         ctx.fillText(text1, centerX, centerY - 10);
                         
                         ctx.font = 'bold 1.2rem sans-serif';
                         ctx.fillStyle = '#111827';
                         ctx.fillText(text2, centerX, centerY + 12);

                         ctx.restore();
                     }
                 };

                 platformRevenueChartInstance.current = new (window as any).Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels,
                        datasets: [{
                            data: data,
                            backgroundColor: labels.map(l => platformColorMap[l] || '#a3a3a3'),
                            hoverOffset: 4
                        }]
                    },
                    plugins: [centerTextPlugin],
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        cutout: '60%',
                        layout: {
                            padding: 10
                        },
                        plugins: { 
                            legend: { display: false }, 
                            tooltip: {
                                callbacks: {
                                    label: (context: TooltipItem<'doughnut'>) => {
                                        const label = context.label || '';
                                        const value = Number(context.parsed);
                                        const total = context.chart.getDatasetMeta(0).total || 1;
                                        
                                        if (platformRevenueView === 'percentage') {
                                            const percentage = ((value / total) * 100).toFixed(1);
                                            return `${label}: ${percentage}%`;
                                        }
                                        const numReservations = reservationsByPlatform[label] || 0;
                                        return `${label}: ${formatCurrency(value)} (${numReservations} reservas)`;
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }
        return () => platformRevenueChartInstance.current?.destroy();
    }, [revenueByPlatform, reservationsByPlatform, platformRevenueView]);

    useEffect(() => {
        if (flatRevenueChartRef.current) {
            if (flatRevenueChartInstance.current) flatRevenueChartInstance.current.destroy();
            const ctx = flatRevenueChartRef.current.getContext('2d');
            const dataToShow = revenueAndAdrByFlat;
            
            if (ctx && Object.keys(dataToShow).length > 0) {
                const flatColorMap: { [key: string]: string } = { '201': '#34d399', '202': '#fbbf24', '301': '#a78bfa' };
                const labels = Object.keys(dataToShow);
                const totalRevenueForPercentage = labels.reduce((sum, l) => sum + dataToShow[l].total, 0);
                
                const values = labels.map(l => {
                    if (flatRevenueView === 'adr') return dataToShow[l].adr;
                    if (flatRevenueDataView === 'value') return dataToShow[l].total;
                    return totalRevenueForPercentage > 0 ? (dataToShow[l].total / totalRevenueForPercentage) * 100 : 0;
                });

                const averageValue = flatRevenueView === 'adr'
                    ? (labels.reduce((sum, l) => sum + dataToShow[l].adr, 0) / labels.length)
                    : (flatRevenueDataView === 'value'
                        ? (labels.reduce((sum, l) => sum + dataToShow[l].total, 0) / labels.length)
                        : (100 / labels.length));
                
                flatRevenueChartInstance.current = new (window as any).Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels,
                        datasets: [{
                            label: flatRevenueView === 'total' ? 'Receita Total' : 'Diária Média (ADR)',
                            data: values,
                            backgroundColor: labels.map(l => flatColorMap[l] || '#a3a3a3'),
                        }, {
                            type: 'line',
                            label: 'Média',
                            data: labels.map(() => averageValue),
                            borderColor: '#f87171',
                            borderWidth: 2,
                            borderDash: [5, 5],
                            fill: false,
                            pointRadius: 0
                        }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        scales: { y: { ticks: { callback: (value) => {
                             if (flatRevenueDataView === 'percentage' && flatRevenueView === 'total') {
                                return `${Number(value).toFixed(0)}%`;
                            }
                            return formatCurrency(Number(value));
                        } } } },
                        plugins: { 
                            legend: { display: false }, 
                             tooltip: { callbacks: { label: (context: TooltipItem<'bar' | 'line'>) => {
                                const label = context.dataset.label || '';
                                const value = Number(context.parsed.y);
                                if (value === null) return '';
                                if (flatRevenueDataView === 'percentage' && flatRevenueView === 'total') {
                                    return `${label}: ${value.toFixed(1)}%`;
                                }
                                return `${label}: ${formatCurrency(value)}`;
                            } } }
                        }
                    }
                });
            }
        }
        return () => flatRevenueChartInstance.current?.destroy();
    }, [revenueAndAdrByFlat, flatRevenueView, flatRevenueDataView]);

    useEffect(() => {
        if (occupancyChartRef.current) {
            if (occupancyChartInstance.current) occupancyChartInstance.current.destroy();
            const ctx = occupancyChartRef.current.getContext('2d');
            if (ctx) {
                const monthLabels = Array.from({ length: 12 }, (_, i) => getMonthName(i + 1).substring(0, 3));
                const currentYearData = yearlyOccupancy.map(d => occupancyView === 'percentage' ? d.occupancyRate : d.totalOccupiedDays);
                const lastYearData = lastYearOccupancy.map(d => occupancyView === 'percentage' ? d.occupancyRate : d.totalOccupiedDays);
                
                const validCurrentYearData = currentYearData.filter(d => d > 0);
                const maxOccupancy = validCurrentYearData.length > 0 ? Math.max(...validCurrentYearData) : 0;
                const minOccupancy = validCurrentYearData.length > 0 ? Math.min(...validCurrentYearData) : 0;

                const pointRadii = currentYearData.map(d => d === maxOccupancy || d === minOccupancy ? 6 : 3);
                const pointColors = currentYearData.map(d => {
                    if (d === maxOccupancy) return 'rgba(16, 185, 129, 1)'; // Green for peak
                    if (d === minOccupancy) return 'rgba(239, 68, 68, 1)'; // Red for valley
                    return 'rgba(139, 92, 246, 1)';
                });

                occupancyChartInstance.current = new (window as any).Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: monthLabels,
                        datasets: [
                            {
                                label: `${selectedYear - 1}`,
                                data: lastYearData,
                                borderColor: 'rgba(156, 163, 175, 0.5)',
                                backgroundColor: 'rgba(156, 163, 175, 0.1)',
                                borderDash: [5, 5],
                                fill: false,
                                tension: 0.3,
                                pointRadius: 0,
                            },
                            {
                                label: `${selectedYear}`,
                                data: currentYearData,
                                borderColor: 'rgba(139, 92, 246, 1)',
                                backgroundColor: 'rgba(139, 92, 246, 0.2)',
                                fill: true,
                                tension: 0.3,
                                pointRadius: pointRadii,
                                pointBackgroundColor: pointColors,
                                pointBorderColor: '#fff',
                                pointBorderWidth: 2,
                            }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        scales: { y: { 
                            beginAtZero: true, 
                            max: occupancyView === 'percentage' ? 100 : undefined,
                            ticks: { callback: (value: string | number) => occupancyView === 'percentage' ? `${value}%` : `${value} dias` } 
                        } },
                        plugins: { 
                            tooltip: { callbacks: { label: (context: TooltipItem<'line'>) => {
                                const label = context.dataset.label || '';
                                const value = Number(context.parsed.y);
                                if (value === null) return '';
                                return `${label}: ${occupancyView === 'percentage' ? `${value.toFixed(1)}%` : `${value.toFixed(0)} dias`}`;
                            } } } 
                        }
                    }
                });
            }
        }
        return () => occupancyChartInstance.current?.destroy();
    }, [yearlyOccupancy, lastYearOccupancy, selectedYear, occupancyView]);


    const handleExportPdf = () => {
        const doc = new (window as any).jspdf.jsPDF();
        
        const flatsTitle = selectedFlats.length === availableFlats.length ? 'Todos os Flats' : `Flats: ${selectedFlats.join(', ')}`;
        const title = `Relatório Financeiro - ${getMonthName(selectedMonth)}/${selectedYear} (${flatsTitle})`;

        doc.text(title, 14, 16);
        let lastY = 20;
    
        doc.setFontSize(12); doc.text('Resumo Geral', 14, lastY + 5);
        (doc as any).autoTable({
            startY: lastY + 7,
            body: [[isFeesAsExpense(selectedYear) ? 'Receitas Brutas' : 'Receita', formatCurrency(grossRevenue)], ['Despesas Totais', formatCurrency(totalExpenses)], ['Total Líquido', formatCurrency(netProfit)], ['Taxa de Ocupação', `${currentMonthOccupancy.toFixed(1)}%`]],
            theme: 'striped', styles: { fontSize: 10, fontStyle: 'bold' }
        });
        lastY = ((doc as any).autoTable.previous?.finalY as number) ?? lastY;
    
        if (Object.keys(revenueByPlatform).length > 0) {
             doc.setFontSize(12); doc.text('Receitas por Plataforma', 14, lastY + 10);
             (doc as any).autoTable({
                startY: lastY + 12, head: [['Plataforma', 'Valor']],
                body: Object.entries(revenueByPlatform).map(([platform, value]: [string, number]) => [platform, formatCurrency(value)]),
                theme: 'grid', headStyles: { fillColor: [75, 192, 192] }
             });
             lastY = ((doc as any).autoTable.previous?.finalY as number) ?? lastY;
        }
    
        if (Object.keys(expenseDetails).length > 0) {
            doc.setFontSize(12); doc.text('Detalhamento das Despesas', 14, lastY + 10);
            (doc as any).autoTable({
                startY: lastY + 12, head: [['Categoria', 'Valor']],
                body: Object.entries(expenseDetails).map(([desc, value]) => [desc, formatCurrency(value as number)]),
                theme: 'grid', headStyles: { fillColor: [255, 99, 132] }
            });
            lastY = ((doc as any).autoTable.previous?.finalY as number) ?? lastY;
        }

        // NEW: Detailed Custom Expenses for Flat 301
        if (selectedFlats.includes('301')) {
            const financialConfigKey301 = `financialConfig301-${selectedYear}-${selectedMonth}`;
            const financialData301 = unifiedData[financialConfigKey301] as FinancialData;
            
            if (financialData301 && financialData301.customExpenses && financialData301.customExpenses.length > 0) {
                 if (lastY > 230) { doc.addPage(); lastY = 20; }
                 
                 doc.setFontSize(12);
                 doc.text('Detalhamento Despesas Customizadas - Flat 301', 14, lastY + 10);
                 
                 const customExpBody = financialData301.customExpenses.map(e => [
                     e.description,
                     formatCurrency(e.value)
                 ]);
                 
                 const totalCustom = financialData301.customExpenses.reduce((sum, e) => sum + (Number(e.value) || 0), 0);
                 
                 (doc as any).autoTable({
                     startY: lastY + 12,
                     head: [['Descrição', 'Valor']],
                     body: customExpBody,
                     foot: [['TOTAL', formatCurrency(totalCustom)]],
                     theme: 'grid',
                     styles: { fontSize: 9 },
                     headStyles: { fillColor: [153, 102, 255] }, 
                     footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'right' },
                     columnStyles: { 1: { halign: 'right' } }
                 });
                 lastY = ((doc as any).autoTable.previous?.finalY as number) ?? lastY;
            }
        }

        // UPDATED: Laundry Control Section for Flat 301 (Detailed)
        // Only generated if there are reservations for Flat 301 in the current context
        const reservations301 = reservationsForTable.filter(r => r.flat === '301');
        const cleaningConfigKey = `cleaningConfig-${selectedYear}-${selectedMonth}`;
        const cleaningData = unifiedData[cleaningConfigKey] as CleaningData;

        if (reservations301.length > 0) {
             // Check for space
             if (lastY > 220) {
                 doc.addPage();
                 lastY = 20;
             }
             
             doc.setFontSize(12); 
             doc.text('Controle de Lavanderia - Flat 301 (Detalhado)', 14, lastY + 10);
             
             let totalLaundryCost301 = 0;

             const laundryBody = reservations301.map(r => {
                 const entry = cleaningData?.laundryEntries?.[r.id];
                 
                 const baseCleaningCost = 100; // Flat 301 base
                 const laundryQty = entry?.laundryQty ?? 25; // Default assumption for 301 if missing
                 const laundryCost = laundryQty * 3;
                 
                 const hasExtraLaundry = entry?.hasExtraLaundry;
                 const extraLaundryQty = hasExtraLaundry ? (entry?.extraLaundryQty || 0) : 0;
                 const extraLaundryCost = extraLaundryQty * 3;
                 
                 const hasExtraCleaning = entry?.hasExtraCleaning;
                 const extraCleaningQty = hasExtraCleaning ? (entry?.extraCleaningQty || 0) : 0;
                 const extraCleaningCost = extraCleaningQty * baseCleaningCost;
                 
                 // Legacy support (optional, but good for completeness)
                 const legacyServicesCost = (entry?.otherServices || []).reduce((sum, service) => {
                    return sum + (service.quantity * service.unitValue);
                 }, 0);

                 const rowTotal = baseCleaningCost + laundryCost + extraLaundryCost + extraCleaningCost + legacyServicesCost;
                 totalLaundryCost301 += rowTotal;
                 
                 return [
                     `${sanitizePdfText(r.guestName)}\n${formatDate(r.checkIn)} a ${formatDate(r.checkOut)}`,
                     laundryQty,
                     hasExtraLaundry ? `Sim (${extraLaundryQty})` : 'Não',
                     hasExtraCleaning ? `Sim (${extraCleaningQty})` : 'Não',
                     formatCurrency(rowTotal)
                 ];
             });

             (doc as any).autoTable({
                startY: lastY + 12, 
                head: [['Hóspede / Período', 'Qtd. Lavanderia', 'Extra Lav?', 'Extra Fax?', 'TOTAL']],
                body: laundryBody,
                foot: [['TOTAL', '', '', '', formatCurrency(totalLaundryCost301)]],
                theme: 'grid', 
                headStyles: { fillColor: [44, 62, 80] },
                styles: { fontSize: 8, valign: 'middle' },
                footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
                columnStyles: { 4: { halign: 'right', fontStyle: 'bold' } }
             });
             lastY = ((doc as any).autoTable.previous?.finalY as number) ?? lastY;
        }
    
        doc.setFontSize(12); doc.text('Detalhes das Reservas', 14, lastY + 10);
        const feesAsExp = isFeesAsExpense(selectedYear);
        const tableHead = feesAsExp
            ? ["FLAT", "HÓSPEDE", "CHECK-IN", "GANHOS BRUTOS", "TAXA", "LÍQUIDO"]
            : ["FLAT", "HÓSPEDE", "CHECK-IN", "RECEITA"];
        const tableBody = reservationsForTable.map(r => feesAsExp
            ? [r.flat, r.guestName, formatDate(r.checkIn), formatCurrency(r.grossEarnings), formatCurrency(r.fees), formatCurrency(r.netEarnings)]
            : [r.flat, r.guestName, formatDate(r.checkIn), formatCurrency(r.netEarnings)]
        );
        (doc as any).autoTable({
            startY: lastY + 12, head: [tableHead],
            body: tableBody,
            theme: 'grid', styles: { fontSize: 8 }, headStyles: { fillColor: [22, 160, 133] },
            didParseCell: (data: any) => { if (data.column.index >= 3) data.cell.styles.halign = 'right'; }
        });
        
        doc.save(`Relatorio_Financeiro_${selectedYear}_${selectedMonth}_Flats_${selectedFlats.join('-')}.pdf`);
    };

    const handleExportExcel = () => {
        const data = isFeesAsExpense(selectedYear)
            ? reservationsForTable.map(r => ({ 'FLAT': r.flat, 'HÓSPEDE': r.guestName, 'CHECK-IN': formatDate(r.checkIn), 'GANHOS BRUTOS': r.grossEarnings, 'TAXA': r.fees, 'LÍQUIDO': r.netEarnings }))
            : reservationsForTable.map(r => ({ 'FLAT': r.flat, 'HÓSPEDE': r.guestName, 'CHECK-IN': formatDate(r.checkIn), 'RECEITA': r.netEarnings }));
        exportToExcel(`Relatorio_Financeiro_${selectedYear}_${selectedMonth}_Flats_${selectedFlats.join('-')}`, data);
    };

    const handleFlatSelectionChange = (flat: string) => {
        setSelectedFlats(prev =>
            prev.includes(flat)
                ? prev.filter(f => f !== flat)
                : [...prev, flat]
        );
    };

    const tableTitle = drillDownMonth ? `DETALHES (RESERVAS DE ${getMonthName(drillDownMonth).toUpperCase()})` : 'DETALHES DE RECEITAS E DESPESAS (RESERVAS DO MÊS)';

    const expandedChartTitle = useMemo(() => {
        switch (expandedChart) {
            case 'revenueExpense': return 'Detalhes de Receitas vs. Despesas';
            case 'platformRevenue': return 'Detalhes de Receitas por Plataforma';
            case 'flatRevenue': return 'Detalhes de Receitas por Flat';
            case 'cashFlow': return `Fluxo de Caixa Mensal (${selectedYear})`;
            case 'occupancy': return `Taxa de Ocupação (${selectedYear} vs ${selectedYear - 1})`;
            default: return 'Gráfico Detalhado';
        }
    }, [expandedChart, selectedYear]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100" title="Painel completo com receitas, despesas, lucro líquido e gráficos de performance para o período selecionado.">
                    {`RELATÓRIO FINANCEIRO REGIME DE COMPETENCIA - ${selectedMonth === 0 ? `ANO DE ${selectedYear}` : `${getMonthName(selectedMonth).toUpperCase()}/${selectedYear}`}`}
                </h2>
                 <div className="flex items-center space-x-2 flex-wrap gap-2">
                    <button onClick={() => setStartFinancialTour(true)} title="Ajuda sobre este relatório" className="bg-blue-100 text-blue-700 p-2 rounded-md hover:bg-blue-200 transition-colors dark:bg-slate-700 dark:text-blue-300 dark:hover:bg-slate-600">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.546-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </button>
                    <button onClick={handleExportPdf} title="Exportar para PDF" className="bg-red-500 text-white p-2 rounded-md hover:bg-red-600"><svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg></button>
                    <button onClick={handleExportExcel} title="Exportar para Excel" className="bg-green-500 text-white p-2 rounded-md hover:bg-green-600"><svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg></button>
                </div>
            </div>

            {/* Flat Filter */}
            <div className="card p-3" data-tour-financial="view-selector">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">Filtrar por Flat:</h3>
                    {availableFlats.map(flat => (
                        <label key={flat} className="flex items-center space-x-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={selectedFlats.includes(flat)}
                                onChange={() => handleFlatSelectionChange(flat)}
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-slate-700 dark:text-slate-200">{`Flat ${flat}`}</span>
                        </label>
                    ))}
                </div>
            </div>
            
            {/* KPI Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-tour-financial="kpis">
                <KpiCard title={getRevenueLabel(selectedYear)} value={formatCurrency(grossRevenue)} />
                <KpiCard 
                    title="Despesas Totais" 
                    value={formatCurrency(totalExpenses)}
                    onClick={() => setIsExpenseModalOpen(true)}
                    tooltip="Clique para ver o detalhamento"
                />
                <KpiCard title="Lucro Líquido" value={formatCurrency(netProfit)} className={netProfit >= 0 ? 'text-green-600' : 'text-red-600'} />
                <KpiCard title="Taxa Ocupação" value={`${currentMonthOccupancy.toFixed(1)}%`} />
            </div>

            {/* Main Content Area: Now Full Width Table */}
            <div className="grid grid-cols-1 gap-6">
                
                {/* Reservations Table */}
                <div className="card p-6" data-tour-financial="details-table">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200">{tableTitle}</h3>
                        {drillDownMonth && <button onClick={() => setDrillDownMonth(null)} className="text-sm text-blue-600 hover:underline">Limpar Filtro</button>}
                    </div>
                    <div className="overflow-x-auto max-h-96">
                        <table className="min-w-full">
                            <thead className="sticky top-0">
                                <tr>
                                    <th>FLAT</th>
                                    <th>HÓSPEDE</th>
                                    <th>CHECK-IN</th>
                                    {isFeesAsExpense(selectedYear) ? (
                                        <>
                                            <th className="text-right">GANHOS BRUTOS</th>
                                            <th className="text-right">TAXA</th>
                                            <th className="text-right">LÍQUIDO</th>
                                        </>
                                    ) : (
                                        <th className="text-right">RECEITA</th>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {reservationsForTable.length > 0 ? reservationsForTable.map(res => (
                                    <tr key={res.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                        <td>{res.flat}</td>
                                        <td>{res.guestName}</td>
                                        <td>{formatDate(res.checkIn)}</td>
                                        {isFeesAsExpense(selectedYear) ? (
                                            <>
                                                <td className="text-right">{formatCurrency(res.grossEarnings)}</td>
                                                <td className="text-right">{formatCurrency(res.fees)}</td>
                                                <td className="text-right font-semibold">{formatCurrency(res.netEarnings)}</td>
                                            </>
                                        ) : (
                                            <td className="text-right font-semibold">{formatCurrency(res.netEarnings)}</td>
                                        )}
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan={isFeesAsExpense(selectedYear) ? 6 : 4} className="py-4 px-4 text-center text-slate-500">Nenhuma reserva encontrada para os filtros selecionados.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Charts Section */}
            <h3 className="text-xl font-bold text-slate-700 dark:text-slate-200 pt-4 border-t">Análise Gráfica</h3>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                 {/* Main Revenue vs Expense Chart */}
                <div className="lg:col-span-2 card p-6" data-tour-financial="main-chart">
                    <div className="flex justify-between items-center mb-4">
                         <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">Receitas vs. Despesas</h3>
                         <div className="flex items-center space-x-2">
                             <button onClick={() => setExpandedChart('revenueExpense')} className="text-xs text-blue-600 hover:underline">Expandir</button>
                             <button onClick={() => setShowRevenueExpenseLegend(!showRevenueExpenseLegend)} className="text-xs text-blue-600 hover:underline">{showRevenueExpenseLegend ? 'Ocultar Legenda' : 'Ver Legenda'}</button>
                             <DataViewToggle options={[{ value: 'value', label: 'R$' }, { value: 'percentage', label: '%' }]} currentValue={revenueExpenseView} onToggle={setRevenueExpenseView} disabled={true} disabledTooltip="Funcionalidade em desenvolvimento" />
                         </div>
                    </div>
                    <div className="relative h-80">
                        <canvas ref={chartRef}></canvas>
                    </div>
                </div>

                {/* Side Charts Stack */}
                <div className="space-y-6">
                    {/* Platform Revenue */}
                    <div className="card p-6">
                        <div className="flex justify-between items-center mb-2">
                             <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">Receita por Plataforma</h3>
                             <div className="flex items-center space-x-2">
                                 <button onClick={() => setExpandedChart('platformRevenue')} className="text-xs text-blue-600 hover:underline">Expandir</button>
                                 <DataViewToggle options={[{ value: 'value', label: 'R$' }, { value: 'percentage', label: '%' }]} currentValue={platformRevenueView} onToggle={setPlatformRevenueView} />
                             </div>
                        </div>
                        <div className="relative h-48">
                            <canvas ref={platformRevenueChartRef}></canvas>
                        </div>
                    </div>
                    {/* Flat Revenue */}
                    <div className="card p-6">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">Receita por Flat</h3>
                             <div className="flex items-center space-x-2">
                                <button onClick={() => setExpandedChart('flatRevenue')} className="text-xs text-blue-600 hover:underline">Expandir</button>
                                <DataViewToggle options={[{ value: 'total', label: 'Total' }, { value: 'adr', label: 'ADR' }]} currentValue={flatRevenueView} onToggle={setFlatRevenueView} />
                                <DataViewToggle options={[{ value: 'value', label: 'R$' }, { value: 'percentage', label: '%' }]} currentValue={flatRevenueDataView} onToggle={setFlatRevenueDataView} disabled={flatRevenueView === 'adr'} />
                            </div>
                        </div>
                        <div className="relative h-48">
                            <canvas ref={flatRevenueChartRef}></canvas>
                        </div>
                    </div>
                </div>
            </div>

             {/* Full Width Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                 <div className="card p-6" data-tour-financial="cash-flow-chart">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">{`Fluxo de Caixa Mensal (${selectedYear})`}</h3>
                        <div className="flex items-center space-x-2">
                             <button onClick={() => setExpandedChart('cashFlow')} className="text-xs text-blue-600 hover:underline">Expandir</button>
                             <DataViewToggle options={[{ value: 'value', label: 'R$' }, { value: 'percentage', label: '%' }]} currentValue={cashFlowView} onToggle={setCashFlowView} />
                        </div>
                    </div>
                    <div className="relative h-80">
                        <canvas ref={cashFlowChartRef}></canvas>
                    </div>
                 </div>
                 <div className="card p-6">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">{`Taxa de Ocupação (${selectedYear} vs ${selectedYear - 1})`}</h3>
                        <div className="flex items-center space-x-2">
                             <button onClick={() => setExpandedChart('occupancy')} className="text-xs text-blue-600 hover:underline">Expandir</button>
                             <DataViewToggle options={[{ value: 'percentage', label: '%' }, { value: 'days', label: 'Dias' }]} currentValue={occupancyView} onToggle={setOccupancyView} />
                        </div>
                    </div>
                    <div className="relative h-80">
                        <canvas ref={occupancyChartRef}></canvas>
                    </div>
                 </div>
            </div>

            {/* Expanded Chart Modal */}
            {expandedChart && (
                <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4" onClick={() => setExpandedChart(null)}>
                    <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-5xl h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-between items-center border-b pb-3 mb-4">
                            <h2 className="text-xl font-bold text-gray-800">{expandedChartTitle}</h2>
                            <button onClick={() => setExpandedChart(null)} className="text-gray-500 hover:text-gray-800 text-3xl font-light">&times;</button>
                        </div>
                        <div className="relative flex-grow">
                             <canvas ref={expandedChartCanvasRef}></canvas>
                        </div>
                    </div>
                </div>
            )}
            
            {isExpenseModalOpen && (
                <ExpenseDetailsModal 
                    isOpen={isExpenseModalOpen}
                    onClose={() => setIsExpenseModalOpen(false)}
                    details={expenseDetails}
                    deductibleDetails={deductibleDetails}
                    monthName={getMonthName(selectedMonth)}
                    year={selectedYear}
                />
            )}
        </div>
    );
};

export default FinancialReport;
