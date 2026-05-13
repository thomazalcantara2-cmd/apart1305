import React, { useMemo, useRef, useEffect, useState } from 'react';
import { formatCurrency, getMonthName, exportToPdf, exportToExcel, formatDate, sanitizePdfText } from '../../utils/helpers';
import type { Chart, ChartEvent, ActiveElement } from 'chart.js';
import { BankDeposit, Reservation, UnifiedData, FinancialData, CleaningData, ManualConciliation } from '../../types';
import { performAutoReconciliation } from '../../utils/reconciliation';
import { CONDOMINIO_201_FIXED, CONDOMINIO_202_FIXED } from '../../constants';

interface Props {
    deposits: BankDeposit[];
    reservations: Reservation[];
    unifiedData: UnifiedData;
    manualAdjustments: Record<string, number>;
    selectedYear: number;
    carneLeaoData: { [year: number]: any[] };
    manualConciliations: ManualConciliation[];
}

const YearlyCashFlowReport: React.FC<Props> = ({ deposits, reservations, unifiedData, manualAdjustments, selectedYear, carneLeaoData, manualConciliations }) => {
    const chartRef = useRef<HTMLCanvasElement>(null);
    const chartInstance = useRef<Chart | null>(null);
    const availableFlats = useMemo(() => ['201', '202', '301'], []);
    const [selectedFlats, setSelectedFlats] = useState<string[]>(['201', '202', '301']);
    const [detailsMonth, setDetailsMonth] = useState<number | null>(null);
    const [activeTab, setActiveTab] = useState<'resumo' | 'detalhado'>('resumo');

    const handleFlatSelectionChange = (flat: string) => {
        setSelectedFlats(prev =>
            prev.includes(flat)
                ? prev.filter(f => f !== flat)
                : [...prev, flat]
        );
    };

    const handleExportChartImage = () => {
        if (!chartRef.current) return;
        
        const canvas = chartRef.current;
        // Criar um canvas temporário para garantir fundo branco (melhor para visualização/impressão)
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        
        if (tempCtx) {
            tempCtx.fillStyle = '#ffffff';
            tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            tempCtx.drawImage(canvas, 0, 0);
            
            const link = document.createElement('a');
            link.download = `Fluxo_Caixa_Anual_${selectedYear}.png`;
            link.href = tempCanvas.toDataURL('image/png');
            link.click();
        }
    };

    const allMatchedPairs = useMemo(() => {
        return performAutoReconciliation(reservations || [], deposits || [], manualAdjustments || {}).matchedPairs;
    }, [reservations, deposits, manualAdjustments]);

    const yearlyData = useMemo(() => {
        const depositMatchMap = new Map<string, Reservation[]>();
        (allMatchedPairs || []).forEach(pair => depositMatchMap.set(pair.deposit.id, pair.reservations));

        const manualMatchMap = new Map<string, Reservation[]>();
        (manualConciliations || []).forEach(mc => {
             const related = (reservations || []).filter(r => mc.reservationIds.includes(r.id));
             mc.depositIds.forEach(dId => manualMatchMap.set(dId, related));
        });

        const isMainBusinessSelected = selectedFlats.includes('201') || selectedFlats.includes('202');

        return Array.from({ length: 12 }, (_, i) => {
            const month = i + 1;
            const expenseDetails: Record<string, number> = {};

            const monthlyAllDeposits = (deposits || []).filter(d => 
                d.date.getUTCFullYear() === selectedYear && d.date.getUTCMonth() + 1 === month
            );

            const enrichedAndFiltered: (BankDeposit & { associatedGuest: string, associatedFlats: string[], platform: string })[] = monthlyAllDeposits.map(deposit => {
                let associatedGuest = '-';
                let associatedFlats: string[] = [];
                let platform = 'Outros';

                const manual = manualMatchMap.get(deposit.id);
                const matched = depositMatchMap.get(deposit.id);

                if (manual && manual.length > 0) {
                    associatedGuest = manual.map(r => r.guestName).join(' + ');
                    associatedFlats = Array.from(new Set(manual.map(r => r.flat)));
                    platform = manual[0].platform;
                } else if (matched && matched.length > 0) {
                    associatedGuest = matched.map(r => r.guestName).join(' + ');
                    associatedFlats = Array.from(new Set(matched.map(r => r.flat)));
                    platform = matched[0].platform;
                } else {
                    const desc = deposit.description.toUpperCase();
                    if (desc.includes('AIRBNB')) platform = 'AIRBNB';
                    else if (desc.includes('BOOKING')) platform = 'BOOKING';
                    else if (desc.includes('DECOLAR')) platform = 'DECOLAR';
                }

                return { ...deposit, associatedGuest, associatedFlats, platform };
            }).filter(d => {
                if (d.associatedFlats.length > 0) {
                    return d.associatedFlats.some(f => 
                        selectedFlats.includes(f) || (f === 'Geral' && isMainBusinessSelected)
                    );
                }
                return isMainBusinessSelected;
            });

            const revenue = enrichedAndFiltered.reduce((sum: number, d) => sum + d.amount, 0);

            // Expenses logic
            const cleaningData = unifiedData[`cleaningConfig-${selectedYear}-${month}`] as CleaningData;
            if (cleaningData?.generalServices) {
                const cost = cleaningData.generalServices
                    .filter(s => selectedFlats.includes(s.flat) || s.flat === 'Geral')
                    .reduce((sum: number, s) => sum + s.value, 0);
                if (cost > 0) expenseDetails['Manutenção/Extras'] = cost;
            }

            if (selectedFlats.includes('201') || selectedFlats.includes('202')) {
                const finData = unifiedData[`financialConfig-${selectedYear}-${month}`] as FinancialData;
                if (finData) {
                    const de = finData.deductibleExpenses || {};
                    if (selectedFlats.includes('201')) {
                        expenseDetails['Condomínio 201'] = (de.condominio || 0);
                        const t = (de.taxaExtra || 0) + (de.energia || 0) + (de.iptu || 0);
                        if (t > 0) expenseDetails['Taxas 201'] = t;
                    }
                    if (selectedFlats.includes('202')) {
                        expenseDetails['Condomínio 202'] = (de.condominio202 || 0);
                        const t = (de.taxaExtra202 || 0) + (de.energia202 || 0) + (de.iptu202 || 0);
                        if (t > 0) expenseDetails['Taxas 202'] = t;
                    }
                    expenseDetails['Mensalidade Stays'] = (finData.otherExpenses?.mensalidadeStays || 0);
                    (finData.customExpenses || []).forEach(e => expenseDetails[e.description || 'Outros'] = e.value);
                } else {
                    if (selectedFlats.includes('201')) expenseDetails['Condomínio 201'] = CONDOMINIO_201_FIXED;
                    if (selectedFlats.includes('202')) expenseDetails['Condomínio 202'] = CONDOMINIO_202_FIXED;
                    expenseDetails['Mensalidade Stays'] = 250;
                }
                let prevY = selectedYear, prevM = month - 1;
                if (month === 1) { prevY = selectedYear - 1; prevM = 12; }
                const prevMonthEntry = (carneLeaoData[prevY] || []).find(d => d.month === prevM);
                const tax = prevMonthEntry?.taxDue || 0;
                if (tax > 0) {
                    const labelImposto = prevMonthEntry && 'rbt12' in prevMonthEntry
                        ? 'Imposto Simples Nacional'
                        : 'Imposto Carnê Leão';
                    expenseDetails[labelImposto] = tax;
                }
            }

            if (selectedFlats.includes('301')) {
                expenseDetails['Sistemas (301)'] = 250;
                const finData301 = unifiedData[`financialConfig301-${selectedYear}-${month}`] as FinancialData;
                if (finData301) {
                    expenseDetails['Despesas 301'] = (Object.values(finData301.deductibleExpenses || {}) as number[]).reduce((a: number, b: number) => a + b, 0);
                }
            }

            const totalExpenses = (Object.values(expenseDetails) as number[]).reduce((sum: number, v: number) => sum + v, 0);

            // --- CÁLCULO DE OCUPAÇÃO ---
            const daysInMonth = new Date(Date.UTC(selectedYear, month, 0)).getUTCDate();
            const startOfMonth = new Date(Date.UTC(selectedYear, month - 1, 1));
            const endOfMonth = new Date(Date.UTC(selectedYear, month, 1));

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

            const totalPossibleNights = daysInMonth * availableFlats.length;
            const totalOccupancyPercentage = totalPossibleNights > 0 ? (totalOccupiedNights / totalPossibleNights) * 100 : 0;

            return {
                month, revenue, expenses: totalExpenses, balance: revenue - totalExpenses,
                deposits: enrichedAndFiltered, expenseDetails,
                occupancy: {
                    totalPercentage: totalOccupancyPercentage,
                    totalNights: totalOccupiedNights,
                    daysInMonth: daysInMonth,
                    byFlat: occupancyByFlat
                }
            };
        });
    }, [deposits, reservations, unifiedData, selectedYear, selectedFlats, allMatchedPairs, manualConciliations, carneLeaoData, availableFlats]);

    const totals = useMemo(() => {
        return yearlyData.reduce<{ revenue: number; expenses: number; balance: number }>((acc, curr) => ({
            revenue: acc.revenue + curr.revenue,
            expenses: acc.expenses + curr.expenses,
            balance: acc.balance + curr.balance
        }), { revenue: 0, expenses: 0, balance: 0 });
    }, [yearlyData]);

    useEffect(() => {
        if (chartRef.current) {
            if (chartInstance.current) chartInstance.current.destroy();
            const ctx = chartRef.current.getContext('2d');
            if (ctx) {
                chartInstance.current = new (window as any).Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: yearlyData.map(d => getMonthName(d.month)),
                        datasets: [
                            { label: 'Receitas (Depósitos)', data: yearlyData.map(d => d.revenue), backgroundColor: '#10b981', borderRadius: 4 }, // Emerald-500
                            { label: 'Despesas Pagas', data: yearlyData.map(d => d.expenses), backgroundColor: '#ef4444', borderRadius: 4 }, // Red-500
                            { 
                                type: 'line', 
                                label: 'Saldo de Caixa', 
                                data: yearlyData.map(d => d.balance), 
                                borderColor: '#3b82f6', // Blue-500
                                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                                borderWidth: 3,
                                pointBackgroundColor: '#fff',
                                pointBorderColor: '#3b82f6',
                                pointRadius: 4,
                                fill: true, 
                                tension: 0.4 
                            }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        onClick: (event: ChartEvent, elements: ActiveElement[]) => {
                            if (elements.length > 0) setDetailsMonth(elements[0].index + 1);
                        },
                        scales: { 
                            x: { grid: { display: false }, border: { display: false } },
                            y: { 
                                beginAtZero: true, 
                                grid: { color: '#f1f5f9', drawBorder: false }, // Slate-100
                                border: { display: false },
                                ticks: { callback: (v: any) => formatCurrency(v), color: '#94a3b8', font: { size: 11 } } 
                            } 
                        },
                        plugins: {
                            legend: { display: true, position: 'top', labels: { usePointStyle: true, boxWidth: 8 } },
                            tooltip: {
                                backgroundColor: '#1e293b',
                                padding: 12,
                                cornerRadius: 8,
                                callbacks: {
                                    label: (context: any) => {
                                        const label = context.dataset.label || '';
                                        const value = context.parsed.y;
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
    }, [yearlyData]);

    const [expandedExpenses, setExpandedExpenses] = useState<Record<number, boolean>>({});

    const toggleExpenseDetails = (month: number) => {
        setExpandedExpenses(prev => ({ ...prev, [month]: !prev[month] }));
    };

    const DetailsModal = ({ month }: { month: number }) => {
        const [modalSelectedFlats, setModalSelectedFlats] = useState<string[]>(availableFlats);

        const rawDetailsData = useMemo(() => {
            return yearlyData.find(d => d.month === month);
        }, [month]);

        const detailsData = useMemo(() => {
            if (!rawDetailsData) return null;

            const isMainBusinessSelectedInModal = modalSelectedFlats.includes('201') || modalSelectedFlats.includes('202');
            const filteredDeposits = rawDetailsData.deposits.filter(d => {
                if (d.associatedFlats.length > 0) {
                    return d.associatedFlats.some(f => 
                        modalSelectedFlats.includes(f) || (f === 'Geral' && isMainBusinessSelectedInModal)
                    );
                }
                return isMainBusinessSelectedInModal;
            });

            const filteredRevenue = filteredDeposits.reduce((sum, d) => sum + d.amount, 0);

            let totalOccPercentage = 0;
            let totalOccNights = 0;
            if (modalSelectedFlats.length > 0) {
                totalOccNights = modalSelectedFlats.reduce((sum, flat) => sum + (rawDetailsData.occupancy.byFlat[flat]?.nights || 0), 0);
                const totalPossibleNights = rawDetailsData.occupancy.daysInMonth * modalSelectedFlats.length;
                totalOccPercentage = totalPossibleNights > 0 ? (totalOccNights / totalPossibleNights) * 100 : 0;
            }

            return {
                ...rawDetailsData,
                deposits: filteredDeposits,
                revenue: filteredRevenue,
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
            
            detailsData.deposits.forEach(dep => {
                const flatKey = dep.associatedFlats.length > 0 ? dep.associatedFlats[0] : 'Indefinido';
                if (!matrix[flatKey]) matrix[flatKey] = { total: 0, platforms: {} };
                matrix[flatKey].platforms[dep.platform] = (matrix[flatKey].platforms[dep.platform] || 0) + dep.amount;
                matrix[flatKey].total += dep.amount;
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

        const { occupancy, deposits: monthDeposits, revenue: monthTotalRevenue } = detailsData;

        return (
            <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4" onClick={() => setDetailsMonth(null)}>
                <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-700 pb-3 mb-4">
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Depósitos de {getMonthName(month)} / {selectedYear}</h2>
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
                                        onChange={() => setModalSelectedFlats(prev => prev.includes(flat) ? prev.filter(f => f !== flat) : [...prev, flat])}
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
                                Desempenho de Ocupação no Período
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-center">
                                <div className="text-center md:border-r border-slate-200 dark:border-slate-600 pr-4">
                                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">OCUPAÇÃO TOTAL</p>
                                    <p className="text-3xl font-black text-indigo-600 dark:text-indigo-400">{occupancy.totalPercentage.toFixed(1)}%</p>
                                    <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase">
                                        {occupancy.totalNights.toFixed(1)} de {occupancy.daysInMonth * modalSelectedFlats.length} dias
                                    </p>
                                </div>
                                <div className="md:col-span-3 space-y-3">
                                    {availableFlats.filter(flat => modalSelectedFlats.includes(flat)).map(flat => {
                                        const flatOcc = occupancy.byFlat[flat];
                                        return (
                                            <div key={flat} className="flex items-center gap-4">
                                                <span className="text-xs font-bold text-slate-600 dark:text-slate-300 w-16">Flat {flat}</span>
                                                <div className="flex-grow bg-slate-200 dark:bg-slate-600 h-3 rounded-full overflow-hidden">
                                                    <div className="bg-indigo-500 h-full rounded-full transition-all duration-500" style={{ width: `${flatOcc?.percentage || 0}%` }}></div>
                                                </div>
                                                <div className="text-right whitespace-nowrap min-w-[120px]">
                                                    <span className="text-[10px] font-bold text-slate-500 mr-2">{flatOcc?.nights.toFixed(1)} de {occupancy.daysInMonth} dias</span>
                                                    <span className="text-xs font-black text-indigo-700 dark:text-indigo-300">{flatOcc?.percentage.toFixed(1)}%</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-600 shadow-sm">
                            <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-500" viewBox="0 0 20 20" fill="currentColor"><path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" /><path fillRule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clipRule="evenodd" /></svg>
                                Fluxo de Recebimento por Apartamento e Canal
                            </h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-50 dark:bg-slate-700">
                                        <tr>
                                            <th className="p-2 text-left font-bold text-slate-600 dark:text-slate-200">APARTAMENTO / PLATAFORMA</th>
                                            <th className="p-2 text-right font-bold text-slate-600 dark:text-slate-200">ENTRADAS (R$)</th>
                                            <th className="p-2 text-right font-bold text-slate-600 dark:text-slate-200">PESO (%)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                        {flatMatrixData.map((flatRow) => {
                                            const flatPercentage = monthTotalRevenue > 0 ? (flatRow.total / monthTotalRevenue) * 100 : 0;
                                            return (
                                                <React.Fragment key={flatRow.flat}>
                                                    <tr className="bg-slate-50/50 dark:bg-slate-700/20 font-bold border-t-2 border-slate-100 dark:border-slate-700">
                                                        <td className="p-3 text-indigo-700 dark:text-indigo-300 uppercase text-xs">
                                                            {flatRow.flat === 'Indefinido' ? 'Não Identificado' : `Flat ${flatRow.flat}`}
                                                        </td>
                                                        <td className="p-3 text-right font-mono text-base">{formatCurrency(flatRow.total)}</td>
                                                        <td className="p-3 text-right">
                                                            <span className="bg-slate-200 dark:bg-slate-600 px-2 py-0.5 rounded text-[10px] uppercase font-black">{flatPercentage.toFixed(1)}% do total</span>
                                                        </td>
                                                    </tr>
                                                    {flatRow.platforms.map((plat) => (
                                                        <tr key={`${flatRow.flat}-${plat.name}`} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                                            <td className="py-2 pl-8 text-slate-600 dark:text-slate-400 italic">
                                                                <span className={`inline-block w-2 h-2 rounded-full mr-2 ${plat.name.includes('AIRBNB') ? 'bg-red-400' : plat.name.includes('BOOKING') ? 'bg-blue-400' : 'bg-slate-400'}`}></span>
                                                                {plat.name}
                                                            </td>
                                                            <td className="py-2 text-right font-mono text-slate-600 dark:text-slate-400">{formatCurrency(plat.value)}</td>
                                                            <td className="py-2 text-right text-slate-500 text-xs">{(plat.value / flatRow.total * 100).toFixed(0)}% do apto</td>
                                                        </tr>
                                                    ))}
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot className="bg-slate-100 dark:bg-slate-700 font-black border-t-2 border-slate-200 dark:border-slate-600">
                                        <tr>
                                            <td className="p-3 text-right uppercase text-xs">TOTAL DE ENTRADAS FILTRADO:</td>
                                            <td className="p-3 text-right font-mono text-lg">{formatCurrency(monthTotalRevenue)}</td>
                                            <td className="p-3 text-right">100%</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>

                        <div>
                            <table className="w-full text-xs">
                                <thead className="sticky top-0 bg-white dark:bg-slate-800">
                                    <tr className="border-b border-slate-200 dark:border-slate-700">
                                        <th className="p-2 text-left">Data</th>
                                        <th className="p-2 text-left">Descrição</th>
                                        <th className="p-2 text-left">Hóspede/Assoc.</th>
                                        <th className="p-2 text-right">Valor</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {monthDeposits.map((dep, idx) => (
                                        <tr key={idx} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                            <td className="p-2 whitespace-nowrap">{formatDate(dep.date)}</td>
                                            <td className="p-2">{dep.description}</td>
                                            <td className="p-2">{dep.associatedGuest}</td>
                                            <td className="p-2 text-right font-mono">{formatCurrency(dep.amount)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const handleExportMonthlyExcel = () => {
        const XLSX = (window as any).XLSX;
        const workbook = XLSX.utils.book_new();

        const thinBorder = { style: 'thin', color: { rgb: 'CCCCCC' } };
        const border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
        const headerStyle = {
            font: { bold: true, color: { rgb: 'FFFFFF' }, name: 'Arial', sz: 10 },
            fill: { patternType: 'solid', fgColor: { rgb: '14259C' } },
            border,
            alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        };
        const bodyStyle = { font: { name: 'Arial', sz: 9 }, border, alignment: { vertical: 'center' } };
        const currStyle = { ...bodyStyle, numFmt: '#,##0.00', alignment: { vertical: 'center', horizontal: 'right' } };
        const totalStyle = {
            font: { bold: true, name: 'Arial', sz: 10 },
            fill: { patternType: 'solid', fgColor: { rgb: 'E8ECF5' } },
            border,
            alignment: { vertical: 'center' },
        };
        const totalCurrStyle = { ...totalStyle, numFmt: '#,##0.00', alignment: { vertical: 'center', horizontal: 'right' } };

        const applyStyles = (ws: any, colCount: number, rowCount: number, currColIndexes: number[], totalRowIndexes: number[]) => {
            for (let C = 0; C < colCount; C++) {
                const addr = XLSX.utils.encode_cell({ r: 0, c: C });
                if (ws[addr]) ws[addr].s = headerStyle;
            }
            for (let R = 1; R <= rowCount; R++) {
                const isTotal = totalRowIndexes.includes(R);
                for (let C = 0; C < colCount; C++) {
                    const addr = XLSX.utils.encode_cell({ r: R, c: C });
                    if (!ws[addr]) continue;
                    const isCurr = currColIndexes.includes(C);
                    if (isTotal) {
                        ws[addr].s = isCurr ? totalCurrStyle : totalStyle;
                    } else {
                        ws[addr].s = isCurr ? currStyle : bodyStyle;
                    }
                }
            }
        };

        // === ABA 1: Resumo Mensal ===
        const resumoRows = yearlyData.map(d => [
            getMonthName(d.month).toUpperCase(),
            d.revenue,
            d.expenses,
            d.balance,
            parseFloat(d.occupancy.totalPercentage.toFixed(1)),
            d.deposits.length,
        ]);
        resumoRows.push(['TOTAL DO ANO', totals.revenue, totals.expenses, totals.balance, '', '']);
        const resumoHeader = ['Mês', 'Receita', 'Despesa', 'Saldo', 'Ocupação (%)', 'Qtd. Depósitos'];
        const wsResumo = XLSX.utils.aoa_to_sheet([resumoHeader, ...resumoRows]);
        wsResumo['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 16 }];
        wsResumo['!rows'] = [{ hpx: 28 }];
        applyStyles(wsResumo, 6, resumoRows.length, [1, 2, 3], [resumoRows.length]);
        XLSX.utils.book_append_sheet(workbook, wsResumo, 'Resumo Mensal');

        // === ABA 2: TOTAIS POR PLATAFORMA ===
        const platformTotals: Record<string, number> = {};
        yearlyData.forEach(md => md.deposits.forEach(dep => {
            platformTotals[dep.platform] = (platformTotals[dep.platform] || 0) + dep.amount;
        }));
        const grandTotal = Object.values(platformTotals).reduce((s, v) => s + v, 0);
        const platRows = Object.entries(platformTotals)
            .sort((a, b) => b[1] - a[1])
            .map(([plat, val]) => [plat, val, grandTotal > 0 ? parseFloat(((val / grandTotal) * 100).toFixed(1)) : 0]);
        platRows.push(['TOTAL GERAL', grandTotal, 100]);
        const platHeader = ['Plataforma', 'Total Recebido (R$)', 'Peso (%)'];
        const wsPlat = XLSX.utils.aoa_to_sheet([platHeader, ...platRows]);
        wsPlat['!cols'] = [{ wch: 20 }, { wch: 22 }, { wch: 12 }];
        wsPlat['!rows'] = [{ hpx: 28 }];
        applyStyles(wsPlat, 3, platRows.length, [1], [platRows.length]);
        XLSX.utils.book_append_sheet(workbook, wsPlat, 'TOTAIS POR PLATAFORMA');

        // === ABA 3: Detalhamento de Depósitos ===
        const detalheHeader = ['Mês', 'Receita Mês', 'Despesa Mês', 'Saldo Mês', 'Ocupação (%)', 'Data Depósito', 'Plataforma', 'Hóspede/Assoc.', 'Flats', 'Valor Depósito'];
        const detalheRows: any[][] = [];
        yearlyData.forEach(monthData => {
            const monthName = getMonthName(monthData.month).toUpperCase();
            if (monthData.deposits.length === 0) {
                detalheRows.push([monthName, monthData.revenue, monthData.expenses, monthData.balance, parseFloat(monthData.occupancy.totalPercentage.toFixed(1)), '-', '-', '-', '-', 0]);
            } else {
                monthData.deposits.forEach(dep => {
                    const depMonthName = (dep.date instanceof Date && !isNaN(dep.date.getTime())) 
                        ? getMonthName(dep.date.getUTCMonth() + 1).toUpperCase() 
                        : monthName;
                    detalheRows.push([
                        depMonthName, monthData.revenue, monthData.expenses, monthData.balance,
                        parseFloat(monthData.occupancy.totalPercentage.toFixed(1)),
                        formatDate(dep.date), dep.platform, dep.associatedGuest,
                        dep.associatedFlats.join(', ') || '-', dep.amount,
                    ]);
                });
            }
        });
        const wsDetalhe = XLSX.utils.aoa_to_sheet([detalheHeader, ...detalheRows]);
        wsDetalhe['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 25 }, { wch: 12 }, { wch: 16 }];
        wsDetalhe['!rows'] = [{ hpx: 28 }];
        applyStyles(wsDetalhe, 10, detalheRows.length, [1, 2, 3, 9], []);
        XLSX.utils.book_append_sheet(workbook, wsDetalhe, 'Detalhamento de Depósitos');

        XLSX.writeFile(workbook, `Detalhamento_Mensal_Caixa_${selectedYear}.xlsx`);
    };

    const handleExportMonthlyPdf = async () => {
        // Load logo as base64
        let logoBase64: string | null = null;
        try {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject();
                img.src = 'https://i.ibb.co/s9Tj3qd1/logoportoprime.jpg';
            });
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(img, 0, 0);
                logoBase64 = canvas.toDataURL('image/jpeg', 0.9);
            }
        } catch (e) { console.warn('Failed to load logo', e); }

        const doc = new (window as any).jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pw = doc.internal.pageSize.getWidth(); // ~210
        const ph = doc.internal.pageSize.getHeight(); // ~297
        const mx = 14; // margin x
        let cy = 0; // cursor y

        // === COLORS ===
        const navy = [20, 37, 156];
        const gold = [205, 164, 94];
        const darkText = [30, 30, 40];
        const midGray = [100, 100, 110];
        const lightBg = [245, 246, 250];

        // === HEADER ===
        doc.setFillColor(...navy);
        doc.rect(0, 0, pw, 28, 'F');

        // Logo on the right
        if (logoBase64) {
            try { doc.addImage(logoBase64, 'JPEG', pw - mx - 22, 4, 22, 16); } catch (e) { console.warn('Failed to add logo to PDF', e); }
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(255, 255, 255);
        doc.text('PORTO PRIME FLATS — Di Maré Residence', mx, 10);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...gold);
        doc.text(`Conciliação de Receitas · Ano-base ${selectedYear}`, mx, 17);
        doc.setFontSize(7);
        doc.setTextColor(180, 190, 220);
        doc.text(`Flats: ${selectedFlats.join(', ')}  ·  Gerado em ${new Date().toLocaleDateString('pt-BR')}`, mx, 23);
        cy = 34;

        // === SUMMARY CARDS (2 columns) ===
        const colW = (pw - 2 * mx - 4) / 2; // 2 cols with 4mm gap

        // Compute platform totals
        const platMap: Record<string, number> = {};
        yearlyData.forEach(md => md.deposits.forEach(dep => {
            platMap[dep.platform] = (platMap[dep.platform] || 0) + dep.amount;
        }));
        const platSorted = Object.entries(platMap).sort((a, b) => b[1] - a[1]);
        const topMonths = [...yearlyData]
            .filter(d => d.revenue > 0)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 3);

        const drawCard = (x: number, title: string, lines: [string, string][]) => {
            doc.setFillColor(...lightBg);
            const cardH = 8 + lines.length * 5.5;
            doc.roundedRect(x, cy, colW, cardH, 1.5, 1.5, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7.5);
            doc.setTextColor(...navy);
            doc.text(title, x + 3, cy + 5.5);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(...darkText);
            lines.forEach(([label, val], i) => {
                const ly = cy + 11 + i * 5.5;
                doc.text(label, x + 3, ly);
                doc.text(val, x + colW - 3, ly, { align: 'right' });
            });
            return cardH;
        };

        const h1 = drawCard(mx, 'Por Plataforma', platSorted.map(([p, v]) => [p + ':', formatCurrency(v)]));
        const h3 = drawCard(mx + colW + 4, 'Meses de maior receita', topMonths.map(m => [getMonthName(m.month) + ':', formatCurrency(m.revenue)]));
        cy += Math.max(h1, h3) + 4;

        // Total banner
        doc.setFillColor(...navy);
        doc.roundedRect(mx, cy, pw - 2 * mx, 8, 1.5, 1.5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(255, 255, 255);
        doc.text(`TOTAL RECEITAS ${selectedYear}:`, mx + 4, cy + 5.5);
        doc.setTextColor(...gold);
        doc.text(formatCurrency(totals.revenue), pw - mx - 4, cy + 5.5, { align: 'right' });
        cy += 13;

        // === DETAIL TABLE ===
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...darkText);
        doc.text('Detalhamento de Depósitos por Hóspede', mx, cy);
        cy += 4;

        const headers = ['Mês', 'Data', 'Hóspede / Referência', 'Plataforma', 'Flat', 'Valor (R$)'];

        const body: any[][] = [];
        yearlyData.forEach(monthData => {
            const monthName = getMonthName(monthData.month).substring(0, 3).toUpperCase();
            const depCount = Math.max(monthData.deposits.length, 1);

            if (monthData.deposits.length === 0) {
                body.push([
                    { content: monthName, rowSpan: 1, styles: { fontStyle: 'bold' } },
                    '-', 'Nenhum depósito', '-', '-', '-'
                ]);
            } else {
                monthData.deposits.forEach((dep, index) => {
                    const row: any[] = [];
                    if (index === 0) {
                        row.push({ content: monthName, rowSpan: depCount, styles: { fontStyle: 'bold', valign: 'middle', fillColor: [240, 242, 250] } });
                    }
                    row.push(
                        formatDate(dep.date),
                        dep.associatedGuest.length > 35 ? dep.associatedGuest.substring(0, 35) + '...' : dep.associatedGuest,
                        dep.platform,
                        dep.associatedFlats.join(', ') || '—',
                        formatCurrency(dep.amount),
                    );
                    body.push(row);
                });
            }
        });

        // Total row
        body.push([
            { content: '', styles: { fillColor: [...navy] } },
            { content: '', styles: { fillColor: [...navy] } },
            { content: 'TOTAL', styles: { fontStyle: 'bold', fillColor: [...navy], textColor: [255, 255, 255], halign: 'right' } },
            { content: '', styles: { fillColor: [...navy] } },
            { content: '', styles: { fillColor: [...navy] } },
            { content: formatCurrency(totals.revenue), styles: { fontStyle: 'bold', fillColor: [...navy], textColor: [...gold], halign: 'right' } },
        ]);

        (doc as any).autoTable({
            startY: cy,
            head: [headers],
            body,
            theme: 'grid',
            styles: {
                fontSize: 7,
                cellPadding: 1.8,
                lineColor: [210, 210, 215],
                lineWidth: 0.2,
                font: 'helvetica',
                textColor: [...darkText],
            },
            headStyles: {
                fillColor: [...navy],
                textColor: [255, 255, 255],
                fontStyle: 'bold',
                fontSize: 7,
                halign: 'center',
                valign: 'middle',
            },
            columnStyles: {
                0: { cellWidth: 18, fontStyle: 'bold' },
                1: { cellWidth: 20 },
                2: { cellWidth: 'auto' },
                3: { cellWidth: 22, halign: 'center' },
                4: { cellWidth: 14, halign: 'center' },
                5: { cellWidth: 26, halign: 'right' },
            },
            margin: { left: mx, right: mx },
        });

        doc.save(`Conciliacao_Receitas_${selectedYear}.pdf`);
    };

    return (
        <div className="space-y-6">
            <div className="card p-6">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-4">
                    <h2 className="text-xl font-bold text-slate-700 dark:text-slate-200">RELATÓRIO DE CAIXA ANUAL - {selectedYear}</h2>
                    <div className="flex gap-2">
                        <button 
                            onClick={handleExportChartImage} 
                            title="Exportar Gráfico (Imagem)"
                            className="bg-indigo-500 text-white p-2 rounded-md hover:bg-indigo-600 transition-colors shadow-sm"
                        >
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                        </button>
                        <button onClick={() => exportToPdf(`Caixa_Anual_${selectedYear}`, ['Mês', 'Receita', 'Despesa', 'Saldo'], yearlyData.map(d => [getMonthName(d.month), formatCurrency(d.revenue), formatCurrency(d.expenses), formatCurrency(d.balance)]))} className="bg-red-500 text-white p-2 rounded-md hover:bg-red-600 transition-colors">
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        </button>
                        <button onClick={() => exportToExcel(`Caixa_Anual_${selectedYear}`, yearlyData.map(d => ({ 'Mês': getMonthName(d.month), 'Receita': d.revenue, 'Despesa': d.expenses, 'Saldo': d.balance })))} className="bg-green-500 text-white p-2 rounded-md hover:bg-green-600 transition-colors">
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        </button>
                    </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-700/50 p-3 rounded-md border border-slate-200 dark:border-slate-700 mb-6">
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                        <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">Flats no Relatório:</h3>
                        {availableFlats.map(flat => (
                            <label key={flat} className="flex items-center space-x-2 cursor-pointer">
                                <input type="checkbox" checked={selectedFlats.includes(flat)} onChange={() => handleFlatSelectionChange(flat)} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                                <span className="text-sm text-slate-700 dark:text-slate-200">{`Flat ${flat}`}</span>
                            </label>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                    <div className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
                        <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">Receita Total Ano</h3>
                        <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{formatCurrency(totals.revenue)}</p>
                    </div>
                    <div className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
                        <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">Despesa Total Ano</h3>
                        <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{formatCurrency(totals.expenses)}</p>
                    </div>
                    <div className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
                        <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">Saldo Final Ano</h3>
                        <p className={`text-2xl font-bold ${totals.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(totals.balance)}</p>
                    </div>
                </div>

                <div className="relative h-96">
                    <canvas ref={chartRef}></canvas>
                </div>
                <p className="text-center text-xs text-slate-400 mt-2 italic">Dica: Clique em uma barra para ver o detalhamento do mês.</p>
            </div>

            <div className="card p-6">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-4">
                    <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200">Detalhamento Mensal</h3>
                    <div className="flex gap-2">
                        <button onClick={handleExportMonthlyPdf} title="Exportar Detalhamento para PDF" className="bg-red-500 text-white p-2 rounded-md hover:bg-red-600 transition-colors">
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        </button>
                        <button onClick={handleExportMonthlyExcel} title="Exportar Detalhamento para Excel" className="bg-green-500 text-white p-2 rounded-md hover:bg-green-600 transition-colors">
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="border-b border-slate-200 dark:border-slate-700 mb-4">
                    <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                        <button
                            onClick={() => setActiveTab('resumo')}
                            className={`${
                                activeTab === 'resumo'
                                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-300'
                            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors`}
                        >
                            Resumo Mensal
                        </button>
                        <button
                            onClick={() => setActiveTab('detalhado')}
                            className={`${
                                activeTab === 'detalhado'
                                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-300'
                            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors`}
                        >
                            Com Detalhamento de Depósitos
                        </button>
                    </nav>
                </div>

                {activeTab === 'resumo' && (
                    <div className="overflow-x-auto">
                        <table className="min-w-full">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-700">
                                    <th className="py-2 px-4 text-left">Mês</th>
                                    <th className="py-2 px-4 text-right">Receita</th>
                                    <th className="py-2 px-4 text-right">Despesa</th>
                                    <th className="py-2 px-4 text-right">Saldo</th>
                                    <th className="py-2 px-4 text-right">Ocupação</th>
                                    <th className="py-2 px-4 text-center">Qtd. Depósitos</th>
                                    <th className="py-2 px-4 text-center">Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {yearlyData.map(d => (
                                    <React.Fragment key={d.month}>
                                        <tr className="hover:bg-slate-50 dark:hover:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
                                            <td className="py-2 px-4 font-medium align-top">{getMonthName(d.month).toUpperCase()}</td>
                                            <td className="py-2 px-4 text-right align-top">{formatCurrency(d.revenue)}</td>
                                            <td className="py-2 px-4 text-right align-top">
                                                <div className="flex flex-col items-end">
                                                    <span>{formatCurrency(d.expenses)}</span>
                                                    {d.expenses > 0 && (
                                                        <button 
                                                            onClick={() => toggleExpenseDetails(d.month)} 
                                                            className="text-[10px] text-blue-500 hover:text-blue-700 hover:underline mt-1 cursor-pointer"
                                                        >
                                                            {expandedExpenses[d.month] ? 'Ocultar Detalhes' : 'Ver Detalhes'}
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                            <td className={`py-2 px-4 text-right font-semibold align-top ${d.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(d.balance)}</td>
                                            <td className="py-2 px-4 text-right font-mono align-top">{d.occupancy.totalPercentage.toFixed(1)}%</td>
                                            <td className="py-2 px-4 text-center font-mono align-top">{d.deposits.length}</td>
                                            <td className="py-2 px-4 text-center align-top">
                                                <button onClick={() => setDetailsMonth(d.month)} className="text-blue-600 hover:text-blue-800 hover:underline text-sm font-bold">Ver Depósitos</button>
                                            </td>
                                        </tr>
                                        {expandedExpenses[d.month] && (
                                            <tr className="bg-slate-50 dark:bg-slate-800/80">
                                                <td colSpan={7} className="py-3 px-6 border-b border-slate-200 dark:border-slate-700">
                                                    <div className="bg-white dark:bg-slate-700 p-4 rounded-lg shadow-sm border border-slate-200 dark:border-slate-600 max-w-2xl mx-auto">
                                                        <h4 className="text-sm font-bold text-slate-600 dark:text-slate-300 mb-3 border-b border-slate-100 dark:border-slate-600 pb-2">Detalhamento das Despesas - {getMonthName(d.month).toUpperCase()}</h4>
                                                        <div className="space-y-2">
                                                            {Object.entries(d.expenseDetails).filter(([_, value]) => Number(value) > 0).map(([key, value]) => (
                                                                <div key={key} className="flex justify-between items-center text-sm">
                                                                    <span className="text-slate-600 dark:text-slate-400">{key}</span>
                                                                    <span className="font-mono text-slate-800 dark:text-slate-200">{formatCurrency(Number(value))}</span>
                                                                </div>
                                                            ))}
                                                            {Object.keys(d.expenseDetails).length === 0 && (
                                                                <div className="text-center text-slate-500 text-sm py-2">Nenhuma despesa registrada no mês.</div>
                                                            )}
                                                            <div className="flex justify-between items-center pt-2 mt-2 border-t border-slate-100 dark:border-slate-600 font-bold">
                                                                <span className="text-slate-700 dark:text-slate-300">TOTAL</span>
                                                                <span className="text-slate-800 dark:text-slate-100">{formatCurrency(d.expenses)}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                            <tfoot className="bg-slate-100 dark:bg-slate-700 font-bold border-t-2 border-slate-200 dark:border-slate-600">
                                <tr>
                                    <td className="py-3 px-4 text-left uppercase text-slate-700 dark:text-slate-200">Total do Ano</td>
                                    <td className="py-3 px-4 text-right text-slate-800 dark:text-slate-100">{formatCurrency(totals.revenue)}</td>
                                    <td className="py-3 px-4 text-right text-slate-800 dark:text-slate-100">{formatCurrency(totals.expenses)}</td>
                                    <td className={`py-3 px-4 text-right ${totals.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(totals.balance)}</td>
                                    <td colSpan={3}></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}

                {activeTab === 'detalhado' && (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-700">
                                    <th className="py-2 px-4 text-left">Mês</th>
                                    <th className="py-2 px-4 text-right">Receita Mês</th>
                                    <th className="py-2 px-4 text-right">Despesa Mês</th>
                                    <th className="py-2 px-4 text-right">Saldo Mês</th>
                                    <th className="py-2 px-4 text-left">Data Dep.</th>
                                    <th className="py-2 px-4 text-left">Descrição</th>
                                    <th className="py-2 px-4 text-left">Hóspede/Assoc.</th>
                                    <th className="py-2 px-4 text-left">Plataforma</th>
                                    <th className="py-2 px-4 text-left">Flats</th>
                                    <th className="py-2 px-4 text-right">Valor Dep.</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                {yearlyData.map(d => {
                                    if (d.deposits.length === 0) {
                                        return (
                                            <tr key={`empty-${d.month}`} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                                                <td className="py-2 px-4 font-medium">{getMonthName(d.month).substring(0, 3).toUpperCase()}</td>
                                                <td className="py-2 px-4 text-right">{formatCurrency(d.revenue)}</td>
                                                <td className="py-2 px-4 text-right">{formatCurrency(d.expenses)}</td>
                                                <td className={`py-2 px-4 text-right font-semibold ${d.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(d.balance)}</td>
                                                <td colSpan={6} className="py-2 px-4 text-center text-slate-400 italic">Nenhum depósito registrado</td>
                                            </tr>
                                        );
                                    }
                                    
                                    return d.deposits.map((dep, idx) => (
                                        <tr key={`${d.month}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                                            {idx === 0 ? (
                                                <>
                                                    <td className="py-2 px-4 font-medium align-top" rowSpan={d.deposits.length}>{getMonthName(d.month).substring(0, 3).toUpperCase()}</td>
                                                    <td className="py-2 px-4 text-right align-top" rowSpan={d.deposits.length}>{formatCurrency(d.revenue)}</td>
                                                    <td className="py-2 px-4 text-right align-top" rowSpan={d.deposits.length}>{formatCurrency(d.expenses)}</td>
                                                    <td className={`py-2 px-4 text-right font-semibold align-top ${d.balance >= 0 ? 'text-green-600' : 'text-red-600'}`} rowSpan={d.deposits.length}>{formatCurrency(d.balance)}</td>
                                                </>
                                            ) : null}
                                            <td className="py-2 px-4 whitespace-nowrap">{formatDate(dep.date)}</td>
                                            <td className="py-2 px-4 truncate max-w-[150px]" title={dep.description}>{dep.description}</td>
                                            <td className="py-2 px-4 truncate max-w-[120px]" title={dep.associatedGuest}>{dep.associatedGuest}</td>
                                            <td className="py-2 px-4">{dep.platform}</td>
                                            <td className="py-2 px-4">{dep.associatedFlats.join(', ') || '-'}</td>
                                            <td className="py-2 px-4 text-right font-mono">{formatCurrency(dep.amount)}</td>
                                        </tr>
                                    ));
                                })}
                            </tbody>
                            <tfoot className="bg-slate-100 dark:bg-slate-700 font-bold border-t-2 border-slate-200 dark:border-slate-600">
                                <tr>
                                    <td className="py-3 px-4 text-left uppercase text-slate-700 dark:text-slate-200">Total do Ano</td>
                                    <td className="py-3 px-4 text-right text-slate-800 dark:text-slate-100">{formatCurrency(totals.revenue)}</td>
                                    <td className="py-3 px-4 text-right text-slate-800 dark:text-slate-100">{formatCurrency(totals.expenses)}</td>
                                    <td className={`py-3 px-4 text-right ${totals.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(totals.balance)}</td>
                                    <td colSpan={6}></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>
            {detailsMonth !== null && <DetailsModal month={detailsMonth} />}
        </div>
    );
};

export default YearlyCashFlowReport;