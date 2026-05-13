
import React, { useMemo, useRef, useEffect } from 'react';
import { UnifiedData, FinancialData } from '../../types';
import { formatCurrency, getMonthName } from '../../utils/helpers';
import { CONDOMINIO_201_FIXED, CONDOMINIO_202_FIXED } from '../../constants';
import type { Chart } from 'chart.js';

interface Props {
    unifiedData: UnifiedData;
    selectedYear: number;
}

const FixedCostsReport: React.FC<Props> = ({ unifiedData, selectedYear }) => {
    const totalCostChartRef = useRef<HTMLCanvasElement>(null);
    const totalCostChartInstance = useRef<Chart | null>(null);
    const energyChartRef = useRef<HTMLCanvasElement>(null);
    const energyChartInstance = useRef<Chart | null>(null);

    const monthlyData = useMemo(() => {
        return Array.from({ length: 12 }, (_, i) => {
            const month = i + 1;
            const configKey201_202 = `financialConfig-${selectedYear}-${month}`;
            const configKey301 = `financialConfig301-${selectedYear}-${month}`;
            
            const data201_202 = unifiedData[configKey201_202] as FinancialData;
            const data301 = unifiedData[configKey301] as FinancialData;

            const expenses = {
                condominio201: data201_202?.deductibleExpenses?.condominio || CONDOMINIO_201_FIXED,
                condominio202: data201_202?.deductibleExpenses?.condominio202 || CONDOMINIO_202_FIXED,
                condominio301: data301?.deductibleExpenses?.condominio || 0,
                energia201: data201_202?.deductibleExpenses?.energia || 0,
                energia202: data201_202?.deductibleExpenses?.energia202 || 0,
                energia301: data301?.deductibleExpenses?.energia || 0,
                internet: (data201_202?.otherExpenses?.mensalidadeStays || 250) + (data301 ? 250 : 0), // Simplified Stays/Internet logic
                iptuTotal: (data201_202?.deductibleExpenses?.iptu || 0) + (data201_202?.deductibleExpenses?.iptu202 || 0) + (data301?.deductibleExpenses?.iptu || 0)
            };

            const totalFixed = Object.values(expenses).reduce((a, b) => a + b, 0);

            return { month, ...expenses, totalFixed };
        });
    }, [unifiedData, selectedYear]);

    useEffect(() => {
        // Chart 1: Total Fixed Costs Stacked
        if (totalCostChartRef.current) {
            if (totalCostChartInstance.current) totalCostChartInstance.current.destroy();
            const ctx = totalCostChartRef.current.getContext('2d');
            if (ctx) {
                totalCostChartInstance.current = new (window as any).Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: monthlyData.map(d => getMonthName(d.month)),
                        datasets: [
                            { label: 'Condomínio (Total)', data: monthlyData.map(d => d.condominio201 + d.condominio202 + d.condominio301), backgroundColor: '#3b82f6' }, // Blue
                            { label: 'Energia (Total)', data: monthlyData.map(d => d.energia201 + d.energia202 + d.energia301), backgroundColor: '#eab308' }, // Yellow
                            { label: 'Internet/Sistemas', data: monthlyData.map(d => d.internet), backgroundColor: '#a855f7' }, // Purple
                            { label: 'IPTU (Total)', data: monthlyData.map(d => d.iptuTotal), backgroundColor: '#f97316' }, // Orange
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            x: { stacked: true },
                            y: { stacked: true, ticks: { callback: (val) => formatCurrency(Number(val)) } }
                        },
                        plugins: {
                            tooltip: {
                                callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(Number(ctx.raw))}` }
                            }
                        }
                    }
                });
            }
        }

        // Chart 2: Energy Comparison Line
        if (energyChartRef.current) {
            if (energyChartInstance.current) energyChartInstance.current.destroy();
            const ctx = energyChartRef.current.getContext('2d');
            if (ctx) {
                energyChartInstance.current = new (window as any).Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: monthlyData.map(d => getMonthName(d.month)),
                        datasets: [
                            { label: 'Energia 201', data: monthlyData.map(d => d.energia201), borderColor: '#34d399', tension: 0.3 },
                            { label: 'Energia 202', data: monthlyData.map(d => d.energia202), borderColor: '#fbbf24', tension: 0.3 },
                            { label: 'Energia 301', data: monthlyData.map(d => d.energia301), borderColor: '#a78bfa', tension: 0.3 },
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: { beginAtZero: true, ticks: { callback: (val) => formatCurrency(Number(val)) } }
                        },
                        plugins: {
                            tooltip: {
                                callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(Number(ctx.raw))}` }
                            }
                        }
                    }
                });
            }
        }

        return () => {
            totalCostChartInstance.current?.destroy();
            energyChartInstance.current?.destroy();
        };
    }, [monthlyData]);

    return (
        <div className="space-y-6">
            <div className="card p-6">
                <h2 className="text-xl font-bold text-slate-700 dark:text-slate-200 mb-4">COMPARATIVO DE CUSTOS FIXOS - {selectedYear}</h2>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                        <h3 className="text-lg font-semibold text-slate-600 dark:text-slate-300 mb-4">Evolução dos Custos Fixos (Composição)</h3>
                        <div className="h-80">
                            <canvas ref={totalCostChartRef}></canvas>
                        </div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                        <h3 className="text-lg font-semibold text-slate-600 dark:text-slate-300 mb-4">Comparativo de Energia (Por Flat)</h3>
                        <div className="h-80">
                            <canvas ref={energyChartRef}></canvas>
                        </div>
                    </div>
                </div>

                <div className="mt-8 overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200">
                                <th className="py-3 px-4 text-left">Mês</th>
                                <th className="py-3 px-4 text-right">Condomínio (Total)</th>
                                <th className="py-3 px-4 text-right">Energia (Total)</th>
                                <th className="py-3 px-4 text-right">Internet/Sis.</th>
                                <th className="py-3 px-4 text-right">IPTU</th>
                                <th className="py-3 px-4 text-right font-bold">TOTAL MENSAL</th>
                            </tr>
                        </thead>
                        <tbody>
                            {monthlyData.map((d) => (
                                <tr key={d.month} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <td className="py-3 px-4 font-medium">{getMonthName(d.month)}</td>
                                    <td className="py-3 px-4 text-right">{formatCurrency(d.condominio201 + d.condominio202 + d.condominio301)}</td>
                                    <td className="py-3 px-4 text-right">{formatCurrency(d.energia201 + d.energia202 + d.energia301)}</td>
                                    <td className="py-3 px-4 text-right">{formatCurrency(d.internet)}</td>
                                    <td className="py-3 px-4 text-right">{formatCurrency(d.iptuTotal)}</td>
                                    <td className="py-3 px-4 text-right font-bold text-slate-800 dark:text-slate-100">{formatCurrency(d.totalFixed)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default FixedCostsReport;
