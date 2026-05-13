
import React, { useMemo, useRef, useEffect } from 'react';
import { ReportType, Reservation, BankDeposit, UnifiedData, CleaningData, FinancialData, ManualConciliation } from '../types';
import { formatCurrency, formatDate, getMonthName } from '../utils/helpers';
import { performAutoReconciliation } from '../utils/reconciliation';
import { CONDOMINIO_201_FIXED, CONDOMINIO_202_FIXED } from '../constants';
import { isFeesAsExpense, getReservationRevenue } from '../utils/feeMode';
import type { Chart, ChartConfiguration } from 'chart.js';

// --- Reusable UI Components ---

const PercentageChange: React.FC<{ current: number; previous: number }> = ({ current, previous }) => {
    if (previous === 0 && current > 0) {
        return <span className="text-sm font-semibold text-green-600">▲ ∞</span>;
    }
    if (previous === 0) {
        return <span className="text-sm font-semibold text-gray-500">-</span>;
    }
    const change = ((current - previous) / previous) * 100;
    const isPositive = change >= 0;

    return (
        <span className={`text-xs font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {isPositive ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%
        </span>
    );
};

const KpiCard: React.FC<{
    title: string;
    value: string;
    changeVsMonth: { current: number; previous: number };
    changeVsYear: { current: number; previous: number };
    sparklineData: number[];
    onClick: () => void;
}> = ({ title, value, changeVsMonth, changeVsYear, sparklineData, onClick }) => {
    const chartRef = useRef<HTMLCanvasElement>(null);
    const chartInstance = useRef<Chart | null>(null);

    useEffect(() => {
        if (chartRef.current) {
            if (chartInstance.current) {
                chartInstance.current.destroy();
            }
            const ctx = chartRef.current.getContext('2d');
            if (ctx) {
                const trend = (sparklineData[sparklineData.length - 1] || 0) - (sparklineData[0] || 0);
                const gradient = ctx.createLinearGradient(0, 0, 0, 64);
                if (trend >= 0) {
                    gradient.addColorStop(0, 'rgba(16, 185, 129, 0.2)');
                    gradient.addColorStop(1, 'rgba(16, 185, 129, 0)');
                } else {
                    gradient.addColorStop(0, 'rgba(239, 68, 68, 0.2)');
                    gradient.addColorStop(1, 'rgba(239, 68, 68, 0)');
                }

                const chartConfig: ChartConfiguration = {
                    type: 'line',
                    data: {
                        labels: Array.from({ length: sparklineData.length }, (_, i) => i.toString()),
                        datasets: [{
                            data: sparklineData,
                            borderColor: trend >= 0 ? '#10b981' : '#ef4444', // Emerald-500 : Red-500
                            borderWidth: 2,
                            fill: true,
                            backgroundColor: gradient,
                            tension: 0.4,
                            pointRadius: 0,
                            pointHoverRadius: 0
                        }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        scales: { x: { display: false }, y: { display: false, min: Math.min(...sparklineData) * 0.95, max: Math.max(...sparklineData) * 1.05 } },
                        plugins: { legend: { display: false }, tooltip: { enabled: false } },
                        interaction: { intersect: false },
                        animation: { duration: 0 }
                    }
                };
                chartInstance.current = new (window as any).Chart(ctx, chartConfig);
            }
        }
        return () => chartInstance.current?.destroy();
    }, [sparklineData]);

    return (
        <div onClick={onClick} className="card p-4 cursor-pointer hover:shadow-lg hover:scale-[1.02] transition-all duration-300 ease-in-out flex flex-col">
            <h3 className="text-base font-semibold text-slate-500 dark:text-slate-400">{title}</h3>
            <p className="text-4xl font-bold text-slate-800 dark:text-slate-100 my-2">{value}</p>
            <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                <span>vs. Mês Ant.</span>
                <PercentageChange current={changeVsMonth.current} previous={changeVsMonth.previous} />
            </div>
            <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                <span>vs. Ano Ant.</span>
                <PercentageChange current={changeVsYear.current} previous={changeVsYear.previous} />
            </div>
            <div className="flex-grow mt-3 h-16">
                <canvas ref={chartRef}></canvas>
            </div>
        </div>
    );
};

// Modern Palette: Blue, Emerald, Amber, Rose, Violet, Cyan, Indigo, Pink
const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#06b6d4', '#6366f1', '#ec4899'];

const ChartCard: React.FC<{
    title: string;
    chartType: 'doughnut' | 'bar';
    chartData: { labels: string[]; data: number[] };
    onClick?: () => void;
    className?: string;
    tooltipLabelCallback?: (context: any) => string;
    'data-tour'?: string;
}> = ({ title, chartType, chartData, onClick, className = '', tooltipLabelCallback, 'data-tour': dataTour }) => {
    const chartRef = useRef<HTMLCanvasElement>(null);
    const chartInstance = useRef<Chart | null>(null);

    useEffect(() => {
        if (chartRef.current) {
            if (chartInstance.current) chartInstance.current.destroy();
            const ctx = chartRef.current.getContext('2d');
            if (ctx) {
                const chartConfig: ChartConfiguration = {
                    type: chartType,
                    data: {
                        labels: chartData.labels,
                        datasets: [{
                            data: chartData.data,
                            backgroundColor: chartType === 'bar'
                                ? chartData.data.map(value => value >= 0 ? '#3b82f6' : '#ef4444') // Blue-500 / Red-500
                                : CHART_COLORS,
                            borderColor: 'transparent',
                            borderWidth: 0,
                            borderRadius: 4,
                            hoverOffset: 4
                        }]
                    },
                    options: {
                        cutout: chartType === 'doughnut' ? '75%' : undefined,
                        responsive: true, maintainAspectRatio: false,
                        scales: {
                            x: { display: chartType === 'bar', grid: { display: false } },
                            y: { display: chartType === 'bar', grid: { display: false }, ticks: { display: false } } // Minimalist bar chart
                        },
                        plugins: {
                            legend: {
                                position: chartType === 'doughnut' ? 'right' : 'none',
                                labels: { boxWidth: 8, usePointStyle: true, padding: 15, font: { size: 11 } }
                            },
                             tooltip: {
                                callbacks: {
                                    label: tooltipLabelCallback || ((context) => {
                                        const label = context.label || '';
                                        const value = context.parsed as number;
                                        const total = context.dataset.data.reduce((a: any, b: any) => a + b, 0) as number;
                                        const percentage = total > 0 ? ((value / total) * 100).toFixed(1) + '%' : '';
                                        return `${label}: ${formatCurrency(value)} (${percentage})`;
                                    })
                                }
                            }
                        },
                        layout: { padding: 0 }
                    }
                };
                chartInstance.current = new (window as any).Chart(ctx, chartConfig);
            }
        }
        return () => chartInstance.current?.destroy();
    }, [chartData, chartType, tooltipLabelCallback]);
    
    return (
        <div onClick={onClick} className={`card p-6 h-96 flex flex-col ${onClick ? 'cursor-pointer hover:shadow-lg' : ''} ${className}`} data-tour={dataTour}>
            <h3 className="text-lg font-semibold text-slate-600 dark:text-slate-300 mb-4 text-center">{title}</h3>
            <div className="relative flex-grow">
                 {chartData.data.reduce((a, b) => a + b, 0) > 0 ? (
                    <canvas ref={chartRef}></canvas>
                 ) : (
                    <div className="flex items-center justify-center h-full text-slate-500">Sem dados para exibir.</div>
                 )}
            </div>
        </div>
    );
};


const InfoCard: React.FC<{
    title: string;
    icon: React.ReactElement;
    onClick: () => void;
    children: React.ReactNode;
    className?: string;
}> = ({ title, icon, onClick, children, className = '' }) => (
    <div 
        onClick={onClick}
        className={`card p-6 cursor-pointer hover:shadow-lg hover:scale-105 transition-all duration-300 ease-in-out flex flex-col ${className}`}
    >
        <div className="flex items-start justify-between">
            <h3 className="text-lg font-semibold text-slate-600 dark:text-slate-300">{title}</h3>
            <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                {icon}
            </div>
        </div>
        <div className="mt-4 flex-grow flex flex-col justify-center">
            {children}
        </div>
    </div>
);


// --- Main Dashboard Component ---

interface DashboardProps {
    reservations: Reservation[];
    deposits: BankDeposit[];
    unifiedData: UnifiedData;
    selectedYear: number;
    selectedMonth: number;
    manualConciliations: ManualConciliation[];
    setActiveReport: (report: ReportType) => void;
    onStartTour: () => void;
    carneLeaoData: { [year: number]: any[] };
}

const Dashboard: React.FC<DashboardProps> = ({
    reservations,
    deposits,
    unifiedData,
    selectedYear,
    selectedMonth,
    manualConciliations,
    setActiveReport,
    onStartTour,
    carneLeaoData
}) => {
    const timelineChartRef = useRef<HTMLCanvasElement>(null);
    const timelineChartInstance = useRef<Chart | null>(null);

    const allTimeMetrics = useMemo(() => {
        const metricsCache = new Map<string, { grossRevenue: number, netProfit: number, occupiedNights: number, adr: number, occupancyRate: number }>();

        const calculate = (year: number, month: number) => {
            const key = `${year}-${month}`;
            if (metricsCache.has(key)) return metricsCache.get(key)!;

            // Revenue calculation
            const monthlyReservations = reservations.filter(r => r.checkIn.getUTCFullYear() === year && r.checkIn.getUTCMonth() + 1 === month);
            const grossRevenue = monthlyReservations.reduce((sum, r) => sum + getReservationRevenue(r, year), 0);
            const platformFees = monthlyReservations.reduce((sum, r) => sum + r.fees, 0);

            // Expense calculation
            const reservationsWithCheckout = reservations.filter(r => r.checkOut.getUTCFullYear() === year && r.checkOut.getUTCMonth() + 1 === month);
            const cleaningData = unifiedData[`cleaningConfig-${year}-${month}`] as CleaningData;
            const cleaningCost201_202 = reservationsWithCheckout.filter(r => ['201', '202'].includes(r.flat)).reduce((total, res) => {
                const entry = cleaningData?.laundryEntries?.[res.id];
                const base = res.flat === '202' ? 80 : 100;
                const laundryQty = entry?.laundryQty ?? (res.flat === '202' ? 15 : 25);
                return total + base + (laundryQty * 3) + (entry?.hasExtraLaundry ? (entry.extraLaundryQty || 0) * 3 : 0) + (entry?.hasExtraCleaning ? (entry.extraCleaningQty || 0) * base : 0);
            }, 0);
            const cleaningCost301 = reservationsWithCheckout.filter(r => r.flat === '301').length * 175; // 100 + 25*3
            const totalCleaningCost = cleaningCost201_202 + cleaningCost301;
            
            const finData201_202 = unifiedData[`financialConfig-${year}-${month}`] as FinancialData;
            const expenses201_202 = finData201_202 ? [...Object.values(finData201_202.deductibleExpenses || {}), ...Object.values(finData201_202.otherExpenses || {}), ...(finData201_202.customExpenses || []).map(e => e.value)].reduce((s, v) => s + (Number(v) || 0), 0) : (CONDOMINIO_201_FIXED + CONDOMINIO_202_FIXED + 250);

            const finData301 = unifiedData[`financialConfig301-${year}-${month}`] as FinancialData;
            const expenses301 = finData301 ? [...Object.values(finData301.deductibleExpenses || {}), ...Object.values(finData301.otherExpenses || {}), ...(finData301.customExpenses || []).map(e => e.value)].reduce((s, v) => s + (Number(v) || 0), 0) : 0;
            
            let prevMonthTaxYear = year;
            let prevTaxMonth = month - 1;
            if (month === 1) {
                prevMonthTaxYear = year - 1;
                prevTaxMonth = 12;
            }
            const carneLeaoTaxFromPrevMonth = carneLeaoData[prevMonthTaxYear]?.find(d => d.month === prevTaxMonth)?.taxDue || 0;

            const totalExpenses = (isFeesAsExpense(year) ? platformFees : 0) + totalCleaningCost + expenses201_202 + expenses301 + carneLeaoTaxFromPrevMonth;
            const netProfit = grossRevenue - totalExpenses;
            
            // Occupancy & ADR Calculation
            const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
            const totalAvailableDays = daysInMonth * 3; // 3 flats
            const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
            const endOfMonth = new Date(Date.UTC(year, month, 1));
            const occupiedNights = reservations.filter(r => r.checkIn < endOfMonth && r.checkOut > startOfMonth).reduce((sum, r) => {
                const start = Math.max(r.checkIn.getTime(), startOfMonth.getTime());
                const end = Math.min(r.checkOut.getTime(), endOfMonth.getTime());
                return sum + (end - start) / (1000 * 60 * 60 * 24);
            }, 0);
            const occupancyRate = totalAvailableDays > 0 ? (occupiedNights / totalAvailableDays) * 100 : 0;
            // ADR (diária média) é métrica de mercado: usa grossEarnings sempre,
            // independente de o ano tratar fees como despesa ou não.
            const grossEarningsTotal = monthlyReservations.reduce((sum, r) => sum + r.grossEarnings, 0);
            const adr = occupiedNights > 0 ? grossEarningsTotal / occupiedNights : 0;

            const result = { grossRevenue, netProfit, occupiedNights, adr, occupancyRate };
            metricsCache.set(key, result);
            return result;
        };

        // Pre-calculate for current and previous years
        for (const y of [selectedYear, selectedYear - 1]) {
            for (let m = 1; m <= 12; m++) {
                calculate(y, m);
            }
        }

        return {
            get: (year: number, month: number) => metricsCache.get(`${year}-${month}`) || { grossRevenue: 0, netProfit: 0, occupiedNights: 0, adr: 0, occupancyRate: 0 }
        };
    }, [reservations, unifiedData, selectedYear, carneLeaoData]);


    const { currentMonthMetrics, prevMonthMetrics, lastYearMetrics } = useMemo(() => {
        const current = allTimeMetrics.get(selectedYear, selectedMonth);
        const prevMonthDate = new Date(selectedYear, selectedMonth - 2, 15); // Use 15 to avoid month-end issues
        const prev = allTimeMetrics.get(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1);
        const lastYear = allTimeMetrics.get(selectedYear - 1, selectedMonth);
        return { currentMonthMetrics: current, prevMonthMetrics: prev, lastYearMetrics: lastYear };
    }, [allTimeMetrics, selectedYear, selectedMonth]);

    const { revenueSparkline, profitSparkline, occupancySparkline, adrSparkline } = useMemo(() => {
        const data: { [key: string]: number[] } = { revenue: [], profit: [], occupancy: [], adr: [] };
        for (let i = 11; i >= 0; i--) {
            const date = new Date(selectedYear, selectedMonth - 1 - i, 15);
            const metrics = allTimeMetrics.get(date.getFullYear(), date.getMonth() + 1);
            data.revenue.push(metrics.grossRevenue);
            data.profit.push(metrics.netProfit);
            data.occupancy.push(metrics.occupancyRate);
            data.adr.push(metrics.adr);
        }
        return { revenueSparkline: data.revenue, profitSparkline: data.profit, occupancySparkline: data.occupancy, adrSparkline: data.adr };
    }, [allTimeMetrics, selectedYear, selectedMonth]);

    const { platformRevenueData, flatRevenueData } = useMemo(() => {
        const monthlyReservations = reservations.filter(r => r.checkIn.getUTCFullYear() === selectedYear && r.checkIn.getUTCMonth() + 1 === selectedMonth);
        
        const platformRev = monthlyReservations.reduce((acc, res) => {
            acc[res.platform] = (acc[res.platform] || 0) + getReservationRevenue(res, selectedYear);
            return acc;
        }, {} as Record<string, number>);

        const flatRev = monthlyReservations.reduce((acc, res) => {
            acc[`Flat ${res.flat}`] = (acc[`Flat ${res.flat}`] || 0) + getReservationRevenue(res, selectedYear);
            return acc;
        }, {} as Record<string, number>);

        return {
            platformRevenueData: { labels: Object.keys(platformRev), data: Object.values(platformRev) },
            flatRevenueData: { labels: Object.keys(flatRev), data: Object.values(flatRev) }
        };
    }, [reservations, selectedYear, selectedMonth]);

    const timelineData = useMemo(() => {
        let accumulatedBalance = 0;
        const months = Array.from({ length: 12 }, (_, i) => i + 1);
        return months.map(month => {
            const metric = allTimeMetrics.get(selectedYear, month);
            accumulatedBalance += metric.netProfit;
            return {
                monthName: getMonthName(month).substring(0, 3),
                monthlyResult: metric.netProfit,
                accumulated: accumulatedBalance
            };
        });
    }, [allTimeMetrics, selectedYear]);

    const upcomingEvents = useMemo(() => {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        return [...reservations.filter(r => r.checkIn >= today).map(r => ({ ...r, type: 'Check-in', date: r.checkIn })),
                ...reservations.filter(r => r.checkOut >= today).map(r => ({ ...r, type: 'Check-out', date: r.checkOut }))]
            .sort((a, b) => a.date.getTime() - b.date.getTime())
            .slice(0, 4);
    }, [reservations]);

    const reconciliationSummary = useMemo(() => {
        const manuallyConciliatedIds = new Set(manualConciliations.flatMap(mc => mc.reservationIds));
        const availableReservations = reservations.filter(r => !manuallyConciliatedIds.has(r.id));
        const { allReservations } = performAutoReconciliation(availableReservations, deposits, {});
        const pending = allReservations.filter(r => !r.matched && r.flat !== '301' && r.platform !== 'Particular');
        return { count: pending.length, amount: pending.reduce((sum, r) => sum + r.netEarnings, 0) };
    }, [reservations, deposits, manualConciliations]);

    useEffect(() => {
        if (timelineChartRef.current) {
            if (timelineChartInstance.current) {
                timelineChartInstance.current.destroy();
            }
            const ctx = timelineChartRef.current.getContext('2d');
            if (ctx) {
                const labels = timelineData.map(d => d.monthName);
                const monthlyResults = timelineData.map(d => d.monthlyResult);
                const accumulatedResults = timelineData.map(d => d.accumulated);

                // Create gradient for the line chart
                const gradientLine = ctx.createLinearGradient(0, 0, 0, 400);
                gradientLine.addColorStop(0, 'rgba(99, 102, 241, 0.5)'); // Indigo-500
                gradientLine.addColorStop(1, 'rgba(99, 102, 241, 0.0)');

                timelineChartInstance.current = new (window as any).Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [
                            {
                                label: 'Saldo Acumulado (Ano)',
                                data: accumulatedResults,
                                type: 'line',
                                borderColor: '#6366f1', // Indigo-500
                                backgroundColor: gradientLine,
                                borderWidth: 3,
                                pointBackgroundColor: '#fff',
                                pointBorderColor: '#6366f1',
                                pointRadius: 4,
                                pointHoverRadius: 6,
                                fill: true,
                                tension: 0.4,
                                order: 1,
                                yAxisID: 'y'
                            },
                            {
                                label: 'Resultado do Mês',
                                data: monthlyResults,
                                backgroundColor: monthlyResults.map(val => val >= 0 ? '#10b981' : '#ef4444'), // Emerald-500 / Red-500
                                borderRadius: 4,
                                order: 2,
                                yAxisID: 'y'
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: {
                            mode: 'index',
                            intersect: false,
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                grid: { color: '#f1f5f9', drawBorder: false }, // Slate-100
                                ticks: { callback: (value: any) => formatCurrency(value), color: '#94a3b8', font: { size: 11 } },
                                border: { display: false }
                            },
                            x: {
                                grid: { display: false },
                                ticks: { color: '#64748b', font: { size: 11 } },
                                border: { display: false }
                            }
                        },
                        plugins: {
                            legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 8 } },
                            tooltip: {
                                backgroundColor: '#1e293b',
                                titleColor: '#f8fafc',
                                bodyColor: '#cbd5e1',
                                padding: 12,
                                cornerRadius: 8,
                                callbacks: {
                                    label: (context) => {
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
        return () => timelineChartInstance.current?.destroy();
    }, [timelineData]);

    return (
        <div className="p-2">
            <div className="flex items-center gap-4 mb-6">
                <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-100">Dashboard</h1>
                <button
                    onClick={onStartTour}
                    title="Ajuda e Tour Guiado"
                    className="bg-blue-100 text-blue-700 p-2 rounded-full hover:bg-blue-200 transition-colors dark:bg-slate-700 dark:text-blue-300 dark:hover:bg-slate-600"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.546-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </button>
            </div>
            
            {/* KPI Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-6" data-tour="step-5-kpis">
                <KpiCard
                    title="Receita Bruta"
                    value={formatCurrency(currentMonthMetrics.grossRevenue)}
                    changeVsMonth={{ current: currentMonthMetrics.grossRevenue, previous: prevMonthMetrics.grossRevenue }}
                    changeVsYear={{ current: currentMonthMetrics.grossRevenue, previous: lastYearMetrics.grossRevenue }}
                    sparklineData={revenueSparkline}
                    onClick={() => setActiveReport(ReportType.Financial)}
                />
                <KpiCard
                    title="Lucro Líquido"
                    value={formatCurrency(currentMonthMetrics.netProfit)}
                    changeVsMonth={{ current: currentMonthMetrics.netProfit, previous: prevMonthMetrics.netProfit }}
                    changeVsYear={{ current: currentMonthMetrics.netProfit, previous: lastYearMetrics.netProfit }}
                    sparklineData={profitSparkline}
                    onClick={() => setActiveReport(ReportType.Financial)}
                />
                <KpiCard
                    title="Taxa de Ocupação"
                    value={`${currentMonthMetrics.occupancyRate.toFixed(1)}%`}
                    changeVsMonth={{ current: currentMonthMetrics.occupancyRate, previous: prevMonthMetrics.occupancyRate }}
                    changeVsYear={{ current: currentMonthMetrics.occupancyRate, previous: lastYearMetrics.occupancyRate }}
                    sparklineData={occupancySparkline}
                    onClick={() => setActiveReport(ReportType.Financial)}
                />
                <KpiCard
                    title="Diária Média (ADR)"
                    value={formatCurrency(currentMonthMetrics.adr)}
                    changeVsMonth={{ current: currentMonthMetrics.adr, previous: prevMonthMetrics.adr }}
                    changeVsYear={{ current: currentMonthMetrics.adr, previous: lastYearMetrics.adr }}
                    sparklineData={adrSparkline}
                    onClick={() => setActiveReport(ReportType.Financial)}
                />
            </div>
            
            {/* Second Row */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
                <ChartCard 
                    title="Receita por Plataforma (Mês)"
                    chartType="doughnut"
                    chartData={platformRevenueData}
                    className="xl:col-span-1"
                    data-tour="step-6-charts"
                />
                 <ChartCard 
                    title="Receita por Flat (Mês)"
                    chartType="doughnut"
                    chartData={flatRevenueData}
                    className="xl:col-span-1"
                />
                <div className="space-y-6 xl:col-span-1">
                     <InfoCard 
                        title="Agenda"
                        icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>}
                        onClick={() => setActiveReport(ReportType.ReceptionCleaning)}
                    >
                        <div className="space-y-3">
                            {upcomingEvents.length > 0 ? upcomingEvents.map(event => (
                                <div key={`${event.id}-${event.type}`} className="flex items-center text-sm">
                                    <span className={`mr-3 px-2 py-1 text-xs font-semibold rounded-full ${event.type === 'Check-in' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{event.type}</span>
                                    <span className="flex-grow text-slate-700 dark:text-slate-200 truncate">{event.guestName} ({event.flat})</span>
                                    <span className="text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">{formatDate(event.date)}</span>
                                </div>
                            )) : <p className="text-center text-slate-500">Nenhum evento próximo.</p>}
                        </div>
                    </InfoCard>
                    <InfoCard 
                        title="Conciliação manual pendente"
                        icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                        onClick={() => setActiveReport(ReportType.InteractiveCompensation)}
                    >
                        <div className="text-center">
                            <p className="text-sm text-slate-500 dark:text-slate-400">Hospedagens a conciliar</p>
                            <p className="text-5xl font-bold text-slate-800 dark:text-slate-100">{reconciliationSummary.count}</p>
                            <p className="text-lg font-semibold text-amber-600 mt-2">{formatCurrency(reconciliationSummary.amount)}</p>
                        </div>
                    </InfoCard>
                </div>
            </div>

             {/* Timeline Chart */}
             <div className="card p-6 h-[32rem] flex flex-col mb-6" onClick={() => setActiveReport(ReportType.YearlyFinancialSummary)}>
                <h3 className="text-lg font-semibold text-slate-600 dark:text-slate-300 mb-4 text-center">Evolução do Fluxo de Caixa (Linha do Tempo Interativa)</h3>
                <div className="relative flex-grow">
                    <canvas ref={timelineChartRef}></canvas>
                </div>
            </div>

        </div>
    );
};

export default Dashboard;
