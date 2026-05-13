
import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { Reservation, UnifiedData, CleaningData, FinancialData } from '../../types';
import { formatCurrency, getMonthName, exportToExcel } from '../../utils/helpers';
import { CONDOMINIO_201_FIXED, CONDOMINIO_202_FIXED } from '../../constants';
import { isFeesAsExpense, getReservationRevenue } from '../../utils/feeMode';
import type { Chart, TooltipItem, ChartEvent, ActiveElement } from 'chart.js';

// Declare introJs to avoid TypeScript errors since it's loaded from a CDN
declare const introJs: any;

interface Props {
    reservations: Reservation[];
    unifiedData: UnifiedData;
    selectedYear: number;
    carneLeaoData: { [year: number]: any[] };
}

const YearlyFinancialSummaryReport: React.FC<Props> = ({ reservations, unifiedData, selectedYear, carneLeaoData }) => {
    const chartRef = useRef<HTMLCanvasElement>(null);
    const chartInstance = useRef<Chart | null>(null);
    const availableFlats = useMemo(() => ['201', '202', '301'], []);
    const [selectedFlats, setSelectedFlats] = useState<string[]>(availableFlats);
    const [detailsMonth, setDetailsMonth] = useState<number | null>(null);
    const [startTour, setStartTour] = useState(false);
    const [ignoredMonths, setIgnoredMonths] = useState<Set<number>>(new Set());
    const [showComparison, setShowComparison] = useState(false);

    useEffect(() => {
        if (startTour) {
            const intro = introJs();
            intro.setOptions({
                steps: [
                    {
                        element: '[data-tour-yearly="title"]',
                        title: 'Resumo Financeiro Anual 🗓️',
                        intro: 'Este relatório oferece uma visão <strong>macro do desempenho</strong> financeiro ao longo do ano selecionado.',
                        position: 'bottom'
                    },
                    {
                        element: '[data-tour-yearly="filters"]',
                        title: 'Filtre por Flat 🔎',
                        intro: '<strong>Selecione ou desmarque</strong> os flats para customizar a visualização.',
                        position: 'bottom'
                    },
                    {
                        element: '[data-tour-yearly="kpis"]',
                        title: 'Totalizadores Anuais 💰',
                        intro: 'Estes cartões mostram os totais consolidados de Receita, Despesa e Lucro.',
                        position: 'bottom'
                    },
                    {
                        element: '[data-tour-yearly="chart"]',
                        title: 'Gráfico Anual 📈',
                        intro: 'Visualize a evolução mensal. Clique em uma barra para ver detalhes.',
                        position: 'top'
                    },
                    {
                        element: '[data-tour-yearly="table"]',
                        title: 'Detalhamento Mensal 🧾',
                        intro: 'Analise o desempenho mês a mês.',
                        position: 'top'
                    },
                ],
                nextLabel: 'Próximo →',
                prevLabel: '← Anterior',
                doneLabel: 'Concluir',
            });
            intro.oncomplete(() => setStartTour(false));
            intro.onexit(() => setStartTour(false));
            intro.start();
        }
    }, [startTour]);


    const handleFlatSelectionChange = (flat: string) => {
        setSelectedFlats(prev =>
            prev.includes(flat)
                ? prev.filter(f => f !== flat)
                : [...prev, flat]
        );
    };

    const toggleMonth = (month: number) => {
        setIgnoredMonths(prev => {
            const next = new Set(prev);
            if (next.has(month)) next.delete(month);
            else next.add(month);
            return next;
        });
    };

    const toggleAllMonths = () => {
        if (ignoredMonths.size > 0) {
            setIgnoredMonths(new Set());
        } else {
            setIgnoredMonths(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
        }
    };

    const calculateMonthData = useCallback((year: number, month: number) => {
        const expenseDetails: Record<string, number> = {};

        const monthlyReservations = reservations.filter(r =>
            selectedFlats.includes(r.flat) &&
            r.checkIn.getUTCFullYear() === year &&
            r.checkIn.getUTCMonth() + 1 === month
        );
        const monthlyRevenue = monthlyReservations.reduce((sum, r) => sum + getReservationRevenue(r, year), 0);
        const platformFees = monthlyReservations.reduce((sum, r) => sum + r.fees, 0);
        if (isFeesAsExpense(year)) {
            // Até 2025: taxas aparecem como linha de despesa
            expenseDetails['Taxas de Plataforma'] = platformFees;
        }
        // 2026+: taxas não viram despesa — receita já vem líquida

        const reservationsWithCheckoutInMonth = reservations.filter(r =>
            selectedFlats.includes(r.flat) &&
            r.checkOut.getUTCFullYear() === year &&
            r.checkOut.getUTCMonth() + 1 === month
        );
        
        const cleaningConfigKey = `cleaningConfig-${year}-${month}`;
        const cleaningDataForMonth = unifiedData[cleaningConfigKey] as CleaningData;
        
        const cleaningCost201_202 = reservationsWithCheckoutInMonth
            .filter(r => ['201', '202'].includes(r.flat))
            .reduce((total, res) => {
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
        const totalCleaningCost = cleaningCost201_202 + cleaningCost301;
        if (totalCleaningCost > 0) expenseDetails['Custo de Limpeza/Lavanderia'] = totalCleaningCost;
        
        let totalGeneralServicesCost = 0;
        if (cleaningDataForMonth?.generalServices) {
            totalGeneralServicesCost = cleaningDataForMonth.generalServices
                .filter(s => selectedFlats.includes(s.flat) || s.flat === 'Geral')
                .reduce((sum, s) => sum + s.value, 0);
        }
        if (totalGeneralServicesCost > 0) expenseDetails['Manutenção/Extras (Lavanderia)'] = totalGeneralServicesCost;

        let expenses201_202 = 0;
        if (selectedFlats.includes('201') || selectedFlats.includes('202')) {
            const financialConfigKey = `financialConfig-${year}-${month}`;
            const financialData = unifiedData[financialConfigKey] as FinancialData;
            if (financialData) {
                const de = financialData.deductibleExpenses || {};
                const oe = financialData.otherExpenses || {};
                const ce = financialData.customExpenses || [];

                if (selectedFlats.includes('201')) {
                    expenseDetails['Condomínio 201'] = de.condominio || 0;
                    if(de.taxaExtra) expenseDetails['Taxa Extra 201'] = de.taxaExtra;
                    if(de.energia) expenseDetails['Energia 201'] = de.energia;
                    if(de.iptu) expenseDetails['IPTU 201'] = de.iptu;
                }
                if (selectedFlats.includes('202')) {
                    expenseDetails['Condomínio 202'] = de.condominio202 || 0;
                    if(de.taxaExtra202) expenseDetails['Taxa Extra 202'] = de.taxaExtra202;
                    if(de.energia202) expenseDetails['Energia 202'] = de.energia202;
                    if(de.iptu202) expenseDetails['IPTU 202'] = de.iptu202;
                }
                expenseDetails['Mensalidade Stays'] = oe.mensalidadeStays || 0;
                ce.forEach(exp => { expenseDetails[exp.description || `Despesa #${exp.id}`] = exp.value; });
                
                expenses201_202 = [...Object.values(de), ...Object.values(oe), ...ce.map(e => e.value)].reduce((sum, v) => sum + (Number(v) || 0), 0);
            } else {
                 if (selectedFlats.includes('201')) { expenseDetails['Condomínio 201'] = CONDOMINIO_201_FIXED; expenses201_202 += CONDOMINIO_201_FIXED; }
                 if (selectedFlats.includes('202')) { expenseDetails['Condomínio 202'] = CONDOMINIO_202_FIXED; expenses201_202 += CONDOMINIO_202_FIXED; }
                 if (selectedFlats.includes('201') || selectedFlats.includes('202')) { expenseDetails['Mensalidade Stays'] = 250; expenses201_202 += 250; }
            }
        }
        
        let expenses301 = 0;
        if (selectedFlats.includes('301')) {
            const financialConfigKey = `financialConfig301-${year}-${month}`;
            const financialData = unifiedData[financialConfigKey] as FinancialData;
            expenses301 += 250;
            expenseDetails['Mensalidade Stays (301)'] = 250;

            if (financialData) {
                const de301 = financialData.deductibleExpenses || {};
                const oe301 = { ...(financialData.otherExpenses || {}) };
                delete oe301.mensalidadeStays;
                const ce301 = financialData.customExpenses || [];
                Object.entries(de301).forEach(([k, v]) => expenseDetails[`${k} (301)`] = v);
                Object.entries(oe301).forEach(([k, v]) => expenseDetails[`${k} (301)`] = v);
                ce301.forEach(exp => { expenseDetails[exp.description || `Despesa #${exp.id} (301)`] = exp.value; });
                expenses301 += [...Object.values(de301), ...Object.values(oe301), ...ce301.map(e => e.value)].reduce((sum, v) => sum + (Number(v) || 0), 0);
            }
        }
        
        let taxFromPrevMonth = 0;
        if (selectedFlats.includes('201') || selectedFlats.includes('202')) {
            let prevMonthTaxYear = year;
            let prevTaxMonth = month - 1;
            if (month === 1) { prevMonthTaxYear = year - 1; prevTaxMonth = 12; }
            const prevMonthData = carneLeaoData[prevMonthTaxYear]?.find(d => d.month === prevTaxMonth);
            taxFromPrevMonth = prevMonthData?.taxDue || 0;
            if (taxFromPrevMonth > 0) {
                const labelImposto = prevMonthData && 'rbt12' in prevMonthData
                    ? 'Imposto Simples Nacional'
                    : 'Imposto Carnê Leão';
                expenseDetails[labelImposto] = taxFromPrevMonth;
            }
        }

        const totalExpenses = (isFeesAsExpense(year) ? platformFees : 0) + totalCleaningCost + totalGeneralServicesCost + expenses201_202 + expenses301 + taxFromPrevMonth;
        const netProfit = monthlyRevenue - totalExpenses;
        const profitMargin = monthlyRevenue > 0 ? (netProfit / monthlyRevenue) * 100 : 0;

        // --- CÁLCULO DE OCUPAÇÃO ---
        const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
        const endOfMonth = new Date(Date.UTC(year, month, 1));

        const occupancyByFlat: Record<string, { nights: number, percentage: number }> = {};
        let totalOccupiedNights = 0;

        availableFlats.forEach(flat => {
            const flatNights = reservations
                .filter(r => r.flat === flat && r.checkIn < endOfMonth && r.checkOut > startOfMonth)
                .reduce((sum, r) => {
                    const effectiveStart = Math.max(r.checkIn.getTime(), startOfMonth.getTime());
                    const effectiveEnd = Math.min(r.checkOut.getTime(), endOfMonth.getTime());
                    const nights = (effectiveEnd - effectiveStart) / (1000 * 60 * 60 * 24);
                    return sum + (nights > 0 ? nights : 0);
                }, 0);
            
            occupancyByFlat[flat] = {
                nights: flatNights,
                percentage: (flatNights / daysInMonth) * 100
            };
            totalOccupiedNights += flatNights;
        });

        const totalAvailableNights = daysInMonth * availableFlats.length;
        const totalOccupancyRate = totalAvailableNights > 0 ? (totalOccupiedNights / totalAvailableNights) * 100 : 0;
        
        return { 
            month, 
            revenue: monthlyRevenue, 
            expenses: totalExpenses, 
            netProfit, 
            profitMargin, 
            reservations: monthlyReservations, 
            expenseDetails,
            occupancy: {
                totalPercentage: totalOccupancyRate,
                totalNights: totalOccupiedNights,
                daysInMonth: daysInMonth,
                byFlat: occupancyByFlat
            }
        };
    }, [reservations, unifiedData, selectedFlats, availableFlats, carneLeaoData]);

    const yearlySummaryData = useMemo(() => {
        return Array.from({ length: 12 }, (_, i) => calculateMonthData(selectedYear, i + 1));
    }, [calculateMonthData, selectedYear]);

    const yearlyTotals = useMemo(() => {
        const activeData = yearlySummaryData.filter(d => !ignoredMonths.has(d.month));
        const totalRevenue = activeData.reduce((sum, data) => sum + data.revenue, 0);
        const totalExpenses = activeData.reduce((sum, data) => sum + data.expenses, 0);
        const totalNetProfit = totalRevenue - totalExpenses;
        const avgProfitMargin = totalRevenue > 0 ? (totalNetProfit / totalRevenue) * 100 : 0;
        return { totalRevenue, totalExpenses, totalNetProfit, avgProfitMargin };
    }, [yearlySummaryData, ignoredMonths]);

    const otherYears = useMemo(() => {
        const years = new Set<number>();
        reservations.forEach(r => years.add(r.checkIn.getUTCFullYear()));
        return Array.from(years).filter(y => y !== selectedYear).sort((a, b) => b - a);
    }, [reservations, selectedYear]);

    const historicalMonthlyData = useMemo(() => {
        const data: Record<number, Record<number, { occupancy: number, margin: number, revenue: number, netProfit: number }>> = {};
        
        otherYears.forEach(year => {
            data[year] = {};
            for (let month = 1; month <= 12; month++) {
                const monthData = calculateMonthData(year, month);
                data[year][month] = {
                    occupancy: monthData.occupancy.totalPercentage,
                    margin: monthData.profitMargin,
                    revenue: monthData.revenue,
                    netProfit: monthData.netProfit
                };
            }
        });
        return data;
    }, [otherYears, calculateMonthData]);

    const historicalYearlyTotals = useMemo(() => {
        const totals: Record<number, { avgMargin: number }> = {};
        otherYears.forEach(year => {
            let totalRev = 0;
            let totalNetProfit = 0;
            for (let month = 1; month <= 12; month++) {
                if (!ignoredMonths.has(month)) {
                    const data = historicalMonthlyData[year]?.[month];
                    if (data) {
                        totalRev += data.revenue;
                        totalNetProfit += data.netProfit;
                    }
                }
            }
            totals[year] = {
                avgMargin: totalRev > 0 ? (totalNetProfit / totalRev) * 100 : 0
            };
        });
        return totals;
    }, [otherYears, historicalMonthlyData, ignoredMonths]);

    useEffect(() => {
        if (chartRef.current) {
            if (chartInstance.current) {
                chartInstance.current.destroy();
            }
            const ctx = chartRef.current.getContext('2d');
            if (ctx) {
                const chartLabels = yearlySummaryData.map(d => getMonthName(d.month));
                const chartRevenue = yearlySummaryData.map(d => ignoredMonths.has(d.month) ? 0 : d.revenue);
                const chartExpenses = yearlySummaryData.map(d => ignoredMonths.has(d.month) ? 0 : d.expenses);
                const chartProfit = yearlySummaryData.map(d => ignoredMonths.has(d.month) ? 0 : d.netProfit);

                chartInstance.current = new (window as any).Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: chartLabels,
                        datasets: [
                            {
                                label: 'Receita Bruta',
                                data: chartRevenue,
                                backgroundColor: '#10b981', // Emerald-500
                                borderRadius: 4,
                                order: 2,
                            },
                            {
                                label: 'Despesas Totais',
                                data: chartExpenses,
                                backgroundColor: '#ef4444', // Red-500
                                borderRadius: 4,
                                order: 3,
                            },
                            {
                                type: 'line',
                                label: 'Lucro Líquido',
                                data: chartProfit,
                                borderColor: '#3b82f6', // Blue-500
                                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                                borderWidth: 3,
                                pointBackgroundColor: '#fff',
                                pointBorderColor: '#3b82f6',
                                pointRadius: 4,
                                tension: 0.4,
                                fill: true,
                                order: 1,
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        onClick: (event: ChartEvent, elements: ActiveElement[]) => {
                            if (elements.length > 0) {
                                const elementIndex = elements[0].index;
                                const clickedMonth = elementIndex + 1;
                                setDetailsMonth(clickedMonth);
                            }
                        },
                        scales: {
                            x: { grid: { display: false }, border: { display: false } },
                            y: {
                                beginAtZero: true,
                                grid: { color: '#f1f5f9', drawBorder: false }, // Slate-100
                                border: { display: false },
                                ticks: {
                                    callback: (value: string | number) => formatCurrency(Number(value)),
                                    color: '#94a3b8', font: { size: 11 }
                                }
                            }
                        },
                        plugins: {
                            legend: { display: true, position: 'top', labels: { usePointStyle: true, boxWidth: 8 } },
                            tooltip: {
                                backgroundColor: '#1e293b',
                                padding: 12,
                                cornerRadius: 8,
                                callbacks: {
                                    label: (context: TooltipItem<'bar' | 'line'>) => {
                                        const label = context.dataset.label || '';
                                        const value = Number(context.parsed.y);
                                        return `${label}: ${formatCurrency(value)}`;
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }
        return () => {
            chartInstance.current?.destroy();
        };
    }, [yearlySummaryData, ignoredMonths]);
    
    const handleExportPdf = () => {
        const doc = new (window as any).jspdf.jsPDF();
        const flatsTitle = selectedFlats.length === availableFlats.length ? 'Todos' : selectedFlats.join(', ');
        const title = `Relatório Anual - ${selectedYear} (Flats: ${flatsTitle})`;
        doc.text(title, 14, 16);
    
        const headers = [["Mês", "Receita Bruta", "Despesas Totais", "Lucro Líquido", "Margem", "Ocupação"]];
        const body = yearlySummaryData.map(d => [
            getMonthName(d.month).toUpperCase() + (ignoredMonths.has(d.month) ? ' (Ignorado)' : ''),
            formatCurrency(d.revenue),
            formatCurrency(d.expenses),
            formatCurrency(d.netProfit),
            `${d.profitMargin.toFixed(1)}%`,
            `${d.occupancy.totalPercentage.toFixed(1)}%`
        ]);
    
        (doc as any).autoTable({
            startY: 22,
            head: headers,
            body: body,
            foot: [[
                'TOTAL (Ativos)',
                formatCurrency(yearlyTotals.totalRevenue),
                formatCurrency(yearlyTotals.totalExpenses),
                formatCurrency(yearlyTotals.totalNetProfit),
                `${yearlyTotals.avgProfitMargin.toFixed(1)}%`,
                ''
            ]],
            theme: 'grid',
            headStyles: { fillColor: [22, 160, 133] },
            footStyles: { fillColor: [44, 62, 80], textColor: [255, 255, 255], fontStyle: 'bold' }
        });
        
        doc.save(`Financeiro_Anual_${selectedYear}.pdf`);
    };

    const handleExportExcel = () => {
        const data = yearlySummaryData.map(d => ({
            'Mês': getMonthName(d.month).toUpperCase() + (ignoredMonths.has(d.month) ? ' (Ignorado)' : ''),
            'Receita Bruta': d.revenue,
            'Despesas Totais': d.expenses,
            'Lucro Líquido': d.netProfit,
            'Margem de Lucro (%)': d.profitMargin,
            'Ocupação (%)': d.occupancy.totalPercentage
        }));
        
        exportToExcel(`Financeiro_Anual_${selectedYear}`, data);
    };

    const DetailsModal = ({ month }: { month: number }) => {
        const [modalSelectedFlats, setModalSelectedFlats] = useState<string[]>(availableFlats);

        const handleModalFlatSelectionChange = (flat: string) => {
            setModalSelectedFlats(prev =>
                prev.includes(flat)
                    ? prev.filter(f => f !== flat)
                    : [...prev, flat]
            );
        };

        const rawDetailsData = useMemo(() => {
            return yearlySummaryData.find(d => d.month === month);
        }, [month]);
    
        const detailsData = useMemo(() => {
            if (!rawDetailsData) return null;

            const filteredReservations = rawDetailsData.reservations.filter(r => modalSelectedFlats.includes(r.flat));
            const filteredRevenue = filteredReservations.reduce((sum, r) => sum + getReservationRevenue(r, selectedYear), 0);

            const filteredExpenseDetails: Record<string, number> = {};
            Object.entries(rawDetailsData.expenseDetails).forEach(([key, value]) => {
                const keyUpper = key.toUpperCase();
                const mentionsOtherFlat = availableFlats.some(f => keyUpper.includes(f) && !modalSelectedFlats.includes(f));
                if (!mentionsOtherFlat) {
                    filteredExpenseDetails[key] = value as number;
                }
            });

            let totalOccPercentage = 0;
            let totalOccNights = 0;
            if (modalSelectedFlats.length > 0) {
                totalOccNights = modalSelectedFlats.reduce((sum, flat) => sum + (rawDetailsData.occupancy.byFlat[flat]?.nights || 0), 0);
                const totalPossibleNights = rawDetailsData.occupancy.daysInMonth * modalSelectedFlats.length;
                totalOccPercentage = totalPossibleNights > 0 ? (totalOccNights / totalPossibleNights) * 100 : 0;
            }

            return {
                ...rawDetailsData,
                reservations: filteredReservations,
                revenue: filteredRevenue,
                expenseDetails: filteredExpenseDetails,
                occupancy: {
                    ...rawDetailsData.occupancy,
                    totalPercentage: totalOccPercentage,
                    totalNights: totalOccNights,
                }
            };
        }, [rawDetailsData, modalSelectedFlats]);

        const flatMatrixData = useMemo(() => {
            if (!detailsData) return [];
            const matrix: Record<string, { total: number; platforms: Record<string, number> }> = {};
            
            detailsData.reservations.forEach(res => {
                if (!matrix[res.flat]) matrix[res.flat] = { total: 0, platforms: {} };
                const rev = getReservationRevenue(res, selectedYear);
                matrix[res.flat].platforms[res.platform] = (matrix[res.flat].platforms[res.platform] || 0) + rev;
                matrix[res.flat].total += rev;
            });

            return Object.entries(matrix)
                .map(([flat, data]) => ({
                    flat,
                    total: data.total,
                    platforms: Object.entries(data.platforms)
                        .map(([p, v]) => ({ name: p, value: v }))
                        .sort((a, b) => b.value - a.value)
                }))
                .sort((a, b) => a.flat.localeCompare(b.flat));
        }, [detailsData]);

        if (!detailsData) return null;
    
        const { occupancy, reservations: monthReservations, revenue: monthTotalRevenue } = detailsData;
    
        return (
            <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4" onClick={() => setDetailsMonth(null)}>
                <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-700 pb-3 mb-4">
                        <div className="flex flex-col">
                            <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Detalhes de {getMonthName(month)} / {selectedYear}</h2>
                        </div>
                        <button onClick={() => setDetailsMonth(null)} className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white text-3xl font-light">&times;</button>
                    </div>

                    <div className="bg-slate-100 dark:bg-slate-700/30 p-3 rounded-lg border border-slate-200 dark:border-slate-600 mb-6">
                        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                            <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Filtrar Flats no Detalhe:</h3>
                            {availableFlats.map(flat => (
                                <label key={flat} className="flex items-center space-x-2 cursor-pointer group">
                                    <input
                                        type="checkbox"
                                        checked={modalSelectedFlats.includes(flat)}
                                        onChange={() => handleModalFlatSelectionChange(flat)}
                                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 group-hover:text-indigo-600 transition-colors">{`Flat ${flat}`}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="overflow-y-auto space-y-8 pr-2 custom-scrollbar">
                        <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4 border border-slate-200 dark:border-slate-600">
                            <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-indigo-500" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" /></svg>
                                Desempenho de Ocupação {modalSelectedFlats.length < availableFlats.length && '(Filtrado)'}
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-center">
                                <div className="text-center md:border-r border-slate-200 dark:border-slate-600 pr-4">
                                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">OCUPAÇÃO TOTAL</p>
                                    <p className="text-3xl font-black text-indigo-600 dark:text-indigo-400">{occupancy.totalPercentage.toFixed(1)}%</p>
                                    <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase">
                                        {occupancy.totalNights.toFixed(1)} de {occupancy.daysInMonth * modalSelectedFlats.length} noites
                                    </p>
                                </div>
                                <div className="md:col-span-3 space-y-3">
                                    {availableFlats
                                        .filter(flat => modalSelectedFlats.includes(flat))
                                        .map(flat => {
                                            const flatOcc = occupancy.byFlat[flat];
                                            return (
                                                <div key={flat} className="flex items-center gap-4">
                                                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300 w-16">Flat {flat}</span>
                                                    <div className="flex-grow bg-slate-200 dark:bg-slate-600 h-3 rounded-full overflow-hidden">
                                                        <div 
                                                            className="bg-indigo-500 h-full rounded-full transition-all duration-500" 
                                                            style={{ width: `${flatOcc?.percentage || 0}%` }}
                                                        ></div>
                                                    </div>
                                                    <div className="text-right whitespace-nowrap min-w-[120px]">
                                                        <span className="text-[10px] font-bold text-slate-500 mr-2">
                                                            {flatOcc?.nights.toFixed(1)} de {occupancy.daysInMonth} dias
                                                        </span>
                                                        <span className="text-xs font-black text-indigo-700 dark:text-indigo-300">{flatOcc?.percentage.toFixed(1)}%</span>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    }
                                </div>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-600 shadow-sm">
                            <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-500" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11 4a1 1 0 10-2 0v4a1 1 0 102 0V7zm-3 1a1 1 0 10-2 0v3a1 1 0 102 0V8zM8 9a1 1 0 00-2 0v2a1 1 0 102 0V9z" clipRule="evenodd" /></svg>
                                Faturamento por Apartamento e Plataformas
                            </h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-50 dark:bg-slate-700">
                                        <tr>
                                            <th className="p-2 text-left font-bold text-slate-600 dark:text-slate-200">APARTAMENTO / PLATAFORMA</th>
                                            <th className="p-2 text-right font-bold text-slate-600 dark:text-slate-200">OCUPAÇÃO DO APTO.</th>
                                            <th className="p-2 text-right font-bold text-slate-600 dark:text-slate-200">RECEITA (R$)</th>
                                            <th className="p-2 text-right font-bold text-slate-600 dark:text-slate-200">PESO (%)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                        {flatMatrixData.map((flatRow) => {
                                            const flatOcc = occupancy.byFlat[flatRow.flat];
                                            const flatPercentage = monthTotalRevenue > 0 ? (flatRow.total / monthTotalRevenue) * 100 : 0;

                                            return (
                                                <React.Fragment key={flatRow.flat}>
                                                    <tr className="bg-slate-50/50 dark:bg-slate-700/20 font-bold border-t-2 border-slate-100 dark:border-slate-700">
                                                        <td className="p-3 text-indigo-700 dark:text-indigo-300 uppercase text-xs">Flat {flatRow.flat}</td>
                                                        <td className="p-3 text-right">
                                                            <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                                                                {flatOcc?.nights.toFixed(1)} de {occupancy.daysInMonth} dias
                                                            </div>
                                                            <div className="text-[10px] text-indigo-500 uppercase tracking-tighter">
                                                                {flatOcc?.percentage.toFixed(1)}% ocupado
                                                            </div>
                                                        </td>
                                                        <td className="p-3 text-right font-mono text-base">
                                                            {formatCurrency(flatRow.total)}
                                                        </td>
                                                        <td className="p-3 text-right">
                                                            <span className="bg-slate-200 dark:bg-slate-600 px-2 py-0.5 rounded text-[10px] uppercase font-black">
                                                                {flatPercentage.toFixed(1)}% do total
                                                            </span>
                                                        </td>
                                                    </tr>
                                                    {flatRow.platforms.map((plat) => (
                                                        <tr key={`${flatRow.flat}-${plat.name}`} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                                            <td className="py-2 pl-8 text-slate-600 dark:text-slate-400 italic">
                                                                <span className={`inline-block w-2 h-2 rounded-full mr-2 ${
                                                                    plat.name.includes('AIRBNB') ? 'bg-red-400' :
                                                                    plat.name.includes('BOOKING') ? 'bg-blue-400' :
                                                                    'bg-slate-400'
                                                                }`}></span>
                                                                {plat.name}
                                                            </td>
                                                            <td className="py-2 text-right text-slate-400">---</td>
                                                            <td className="py-2 text-right font-mono text-slate-600 dark:text-slate-400">
                                                                {formatCurrency(plat.value)}
                                                            </td>
                                                            <td className="py-2 text-right text-slate-500 text-xs">
                                                                {(plat.value / flatRow.total * 100).toFixed(0)}% do apto
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot className="bg-slate-100 dark:bg-slate-700 font-black border-t-2 border-slate-200 dark:border-slate-600">
                                        <tr>
                                            <td className="p-3 text-right uppercase text-xs">TOTAL GERAL FILTRADO:</td>
                                            <td className="p-3 text-right text-indigo-600 dark:text-indigo-400">
                                                {occupancy.totalNights.toFixed(1)} de {occupancy.daysInMonth * modalSelectedFlats.length} dias ({occupancy.totalPercentage.toFixed(1)}%)
                                            </td>
                                            <td className="p-3 text-right font-mono text-lg">{formatCurrency(monthTotalRevenue)}</td>
                                            <td className="p-3 text-right">100%</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <div className="card p-6">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-4">
                     <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-slate-700 dark:text-slate-200" data-tour-yearly="title">RELATÓRIO FINANCEIRO ANUAL - {selectedYear}</h2>
                        <button onClick={() => setStartTour(true)} title="Ajuda sobre este relatório" className="bg-blue-100 text-blue-700 p-2 rounded-full hover:bg-blue-200 transition-colors dark:bg-slate-700 dark:text-blue-300 dark:hover:bg-slate-600">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.546-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </button>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-2">
                        <button onClick={() => setShowComparison(!showComparison)} className={`px-4 py-2 rounded-md font-semibold text-white transition-colors text-sm ${showComparison ? 'bg-blue-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
                            {showComparison ? 'Ocultar Comparativo' : 'Comparar'}
                        </button>
                        <button onClick={handleExportPdf} title="Exportar para PDF" className="bg-red-500 text-white p-2 rounded-md hover:bg-red-600"><svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg></button>
                        <button onClick={handleExportExcel} title="Exportar para Excel" className="bg-green-500 text-white p-2 rounded-md hover:bg-green-600"><svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg></button>
                    </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-700/50 p-3 rounded-md border border-slate-200 dark:border-slate-700" data-tour-yearly="filters">
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

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 my-6 text-center" data-tour-yearly="kpis">
                    <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg"><h4 className="text-sm font-medium text-slate-500">Receita Anual</h4><p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{formatCurrency(yearlyTotals.totalRevenue)}</p></div>
                    <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg"><h4 className="text-sm font-medium text-slate-500">Despesa Anual</h4><p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{formatCurrency(yearlyTotals.totalExpenses)}</p></div>
                    <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg"><h4 className="text-sm font-medium text-slate-500">Lucro Líquido</h4><p className={`text-2xl font-bold ${yearlyTotals.totalNetProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(yearlyTotals.totalNetProfit)}</p></div>
                    <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg"><h4 className="text-sm font-medium text-slate-500">Margem Média</h4><p className={`text-2xl font-bold ${yearlyTotals.avgProfitMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>{yearlyTotals.avgProfitMargin.toFixed(1)}%</p></div>
                </div>

                <div className="relative h-96" data-tour-yearly="chart">
                    <canvas ref={chartRef}></canvas>
                </div>
                <p className="text-center text-xs text-slate-400 mt-2">Dica: Clique em uma barra para ver o detalhamento do mês.</p>
            </div>

            <div className="card p-6" data-tour-yearly="table">
                <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200 mb-4">Detalhamento Mensal</h3>
                <div className="overflow-x-auto">
                    <table className="min-w-full">
                        <thead className="sticky top-0">
                            <tr>
                                <th className="py-2 px-2 border-b text-center w-10">
                                    <input 
                                        type="checkbox" 
                                        checked={ignoredMonths.size === 0} 
                                        onChange={toggleAllMonths}
                                        title={ignoredMonths.size === 0 ? "Desmarcar todos" : "Marcar todos"}
                                        className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                                    />
                                </th>
                                <th className="py-2 px-4 border-b text-left">Mês</th>
                                <th className="py-2 px-4 border-b text-right">Receita Bruta</th>
                                <th className="py-2 px-4 border-b text-right">Lucro Líquido</th>
                                <th className="py-2 px-4 border-b text-right">Ocupação {showComparison && selectedYear}</th>
                                {showComparison && otherYears.map(year => (
                                    <th key={`occ-${year}`} className="py-2 px-4 border-b text-right text-slate-400">Ocupação {year}</th>
                                ))}
                                <th className="py-2 px-4 border-b text-right">Margem {showComparison && selectedYear}</th>
                                {showComparison && otherYears.map(year => (
                                    <th key={`mar-${year}`} className="py-2 px-4 border-b text-right text-slate-400">Margem {year}</th>
                                ))}
                                <th className="py-2 px-4 border-b text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {yearlySummaryData.map(data => (
                                <tr key={data.month} className={`hover:bg-slate-50 dark:hover:bg-slate-700/50 ${ignoredMonths.has(data.month) ? 'opacity-40 grayscale' : ''}`}>
                                    <td className="py-2 px-2 border-b text-center">
                                        <input 
                                            type="checkbox" 
                                            checked={!ignoredMonths.has(data.month)} 
                                            onChange={() => toggleMonth(data.month)}
                                            className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                                        />
                                    </td>
                                    <td className="py-2 px-4 border-b font-medium">{getMonthName(data.month).toUpperCase()}</td>
                                    <td className="py-2 px-4 border-b text-right">{formatCurrency(data.revenue)}</td>
                                    <td className={`py-2 px-4 border-b text-right font-semibold ${data.netProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatCurrency(data.netProfit)}</td>
                                    <td className="py-2 px-4 border-b text-right font-mono">{data.occupancy.totalPercentage.toFixed(1)}%</td>
                                    {showComparison && otherYears.map(year => {
                                        const histData = historicalMonthlyData[year]?.[data.month];
                                        return (
                                            <td key={`occ-${year}-${data.month}`} className="py-2 px-4 border-b text-right font-mono text-slate-500">
                                                {histData ? `${histData.occupancy.toFixed(1)}%` : '-'}
                                            </td>
                                        );
                                    })}
                                    <td className={`py-2 px-4 border-b text-right font-semibold ${data.profitMargin >= 0 && data.revenue > 0 ? 'text-green-700' : (data.revenue > 0 ? 'text-red-700' : 'text-slate-500')}`}>{data.revenue > 0 ? `${data.profitMargin.toFixed(1)}%` : '-'}</td>
                                    {showComparison && otherYears.map(year => {
                                        const histData = historicalMonthlyData[year]?.[data.month];
                                        return (
                                            <td key={`mar-${year}-${data.month}`} className={`py-2 px-4 border-b text-right font-semibold ${histData && histData.margin >= 0 && histData.revenue > 0 ? 'text-green-600/70' : (histData && histData.revenue > 0 ? 'text-red-600/70' : 'text-slate-400')}`}>
                                                {histData && histData.revenue > 0 ? `${histData.margin.toFixed(1)}%` : '-'}
                                            </td>
                                        );
                                    })}
                                    <td className="py-2 px-4 border-b text-center">
                                        <button onClick={() => setDetailsMonth(data.month)} className="text-blue-600 hover:text-blue-800 hover:underline text-sm font-semibold">
                                            Ver Detalhes
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-slate-800 text-white font-bold sticky bottom-0">
                            <tr>
                                <td className="py-3 px-4" colSpan={2}>TOTAL {ignoredMonths.size > 0 && '(Ativos)'}</td>
                                <td className="py-3 px-4 text-right">{formatCurrency(yearlyTotals.totalRevenue)}</td>
                                <td className="py-3 px-4 text-right">{formatCurrency(yearlyTotals.totalNetProfit)}</td>
                                <td className="py-3 px-4"></td>
                                {showComparison && otherYears.map(year => <td key={`ft-occ-${year}`} className="py-3 px-4"></td>)}
                                <td className="py-3 px-4 text-right">{yearlyTotals.avgProfitMargin.toFixed(1)}%</td>
                                {showComparison && otherYears.map(year => {
                                    const yearData = historicalYearlyTotals[year];
                                    return (
                                        <td key={`ft-mar-${year}`} className="py-3 px-4 text-right text-slate-300">
                                            {yearData ? `${yearData.avgMargin.toFixed(1)}%` : '-'}
                                        </td>
                                    );
                                })}
                                <td className="py-3 px-4"></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
            {detailsMonth !== null && <DetailsModal month={detailsMonth} />}
        </div>
    );
};

export default YearlyFinancialSummaryReport;
