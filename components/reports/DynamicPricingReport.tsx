
import React, { useState, useMemo } from 'react';
import { Reservation } from '../../types';
import { formatCurrency, formatDate, getMonthName } from '../../utils/helpers';
import { GoogleGenAI, Type } from "@google/genai";

interface Props {
    reservations: Reservation[];
}

interface PricingSuggestion {
    flatId: string;
    historicalAverage: number;
    suggestedRateWeekday: number;
    suggestedRateWeekend: number;
    justification: string;
}

interface PackageIdea {
    title: string;
    targetAudience: string;
    description: string;
    conditions: string;
}

interface Scenario {
    name: string;
    description: string;
    priceChange: string;
    projectedOccupancy: string;
    projectedRevenueImpact: string;
    color: string;
}

interface GeminiResponse {
    lowSeasonAnalysis: string;
    localEvents: string[];
    marketPositioning: string;
    pricingSuggestions: PricingSuggestion[];
    packages: PackageIdea[];
    scenarios: Scenario[];
    strategyForEmptyDays: string;
}

const DynamicPricingReport: React.FC<Props> = ({ reservations }) => {
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<GeminiResponse | null>(null);
    const [activeTab, setActiveTab] = useState<'prices' | 'packages' | 'scenarios'>('prices');
    
    const [manualMonth, setManualMonth] = useState<number>(new Date().getUTCMonth() + 1);
    const [manualYear, setManualYear] = useState<number>(new Date().getUTCFullYear());

    // --- CÁLCULO DE REFERÊNCIA HISTÓRICA REAL ---
    const historicalPerformance = useMemo(() => {
        // Garantir cálculo em UTC para evitar bugs de virada de mês em fuso local
        const daysInMonth = new Date(Date.UTC(manualYear, manualMonth, 0)).getUTCDate();
        const startOfMonth = new Date(Date.UTC(manualYear, manualMonth - 1, 1));
        const endOfMonth = new Date(Date.UTC(manualYear, manualMonth, 1));
        
        const flats = ['201', '202', '301'];
        const stats: Record<string, { totalRevenue: number, occupiedNights: number, adr: number, occupancyRate: number }> = {};

        flats.forEach(flat => {
            let flatRev = 0;
            let flatNights = 0;

            // Filtro com normalização de nome para evitar discrepâncias (ex: "Apartamento 201" vs "201")
            reservations.filter(r => 
                (r.flat.includes(flat) || r.flat === flat) && 
                r.checkIn < endOfMonth && 
                r.checkOut > startOfMonth
            ).forEach(r => {
                const effectiveStart = Math.max(r.checkIn.getTime(), startOfMonth.getTime());
                const effectiveEnd = Math.min(r.checkOut.getTime(), endOfMonth.getTime());
                // Arredonda para evitar problemas com frações de milissegundos
                const nightsInMonth = Math.round((effectiveEnd - effectiveStart) / (1000 * 60 * 60 * 24));
                
                if (nightsInMonth > 0) {
                    const totalResNights = Math.round((r.checkOut.getTime() - r.checkIn.getTime()) / (1000 * 60 * 60 * 24));
                    const nightlyRate = r.grossEarnings / (totalResNights || 1);
                    
                    flatRev += nightlyRate * nightsInMonth;
                    flatNights += nightsInMonth;
                }
            });

            stats[flat] = {
                totalRevenue: flatRev,
                occupiedNights: flatNights,
                adr: flatNights > 0 ? flatRev / flatNights : 0,
                occupancyRate: (flatNights / daysInMonth) * 100
            };
        });

        return { stats, daysInMonth };
    }, [reservations, manualMonth, manualYear]);

    const handleManualMonthAnalyze = () => {
        const start = new Date(Date.UTC(manualYear, manualMonth - 1, 1));
        const end = new Date(Date.UTC(manualYear, manualMonth, 0));
        
        setStartDate(start.toISOString().split('T')[0]);
        setEndDate(end.toISOString().split('T')[0]);
        handleAnalyze(start, end);
    };

    const handleAnalyze = async (overrideStart: Date, overrideEnd: Date) => {
        setIsLoading(true);
        setError(null);
        setResult(null);
        setActiveTab('prices');

        try {
            const prompt = `
                Você é um Gerente de Revenue Management Sênior especializado em Porto de Galinhas.
                Analise o período de ${getMonthName(manualMonth)} de ${manualYear}.
                DADOS HISTÓRICOS REAIS DO MÊS:
                Flat 201: ADR ${formatCurrency(historicalPerformance.stats['201'].adr)}, Ocupação ${historicalPerformance.stats['201'].occupancyRate.toFixed(1)}% (${historicalPerformance.stats['201'].occupiedNights} de ${historicalPerformance.daysInMonth} dias)
                Flat 202: ADR ${formatCurrency(historicalPerformance.stats['202'].adr)}, Ocupação ${historicalPerformance.stats['202'].occupancyRate.toFixed(1)}% (${historicalPerformance.stats['202'].occupiedNights} de ${historicalPerformance.daysInMonth} dias)
                Flat 301: ADR ${formatCurrency(historicalPerformance.stats['301'].adr)}, Ocupação ${historicalPerformance.stats['301'].occupancyRate.toFixed(1)}% (${historicalPerformance.stats['301'].occupiedNights} de ${historicalPerformance.daysInMonth} dias)
                
                Seu objetivo é sugerir preços para o MESMO PERÍODO no ano seguinte para melhorar esses indicadores.
                Retorne JSON estrito com o esquema definido.
            `;

            const schema = {
                type: Type.OBJECT,
                properties: {
                    lowSeasonAnalysis: { type: Type.STRING },
                    localEvents: { type: Type.ARRAY, items: { type: Type.STRING } },
                    marketPositioning: { type: Type.STRING },
                    pricingSuggestions: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                flatId: { type: Type.STRING },
                                historicalAverage: { type: Type.NUMBER },
                                suggestedRateWeekday: { type: Type.NUMBER },
                                suggestedRateWeekend: { type: Type.NUMBER },
                                justification: { type: Type.STRING }
                            },
                             required: ["flatId", "historicalAverage", "suggestedRateWeekday", "suggestedRateWeekend", "justification"]
                        }
                    },
                    packages: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: { title: { type: Type.STRING }, targetAudience: { type: Type.STRING }, description: { type: Type.STRING }, conditions: { type: Type.STRING } },
                            required: ["title", "targetAudience", "description", "conditions"]
                        }
                    },
                    scenarios: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING },
                                description: { type: Type.STRING },
                                priceChange: { type: Type.STRING },
                                projectedOccupancy: { type: Type.STRING },
                                projectedRevenueImpact: { type: Type.STRING },
                                color: { type: Type.STRING, enum: ["green", "blue", "orange"] }
                            },
                            required: ["name", "description", "priceChange", "projectedOccupancy", "projectedRevenueImpact", "color"]
                        }
                    },
                    strategyForEmptyDays: { type: Type.STRING }
                },
                required: ["lowSeasonAnalysis", "localEvents", "marketPositioning", "pricingSuggestions", "packages", "scenarios", "strategyForEmptyDays"]
            };
            
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: prompt,
                config: { responseMimeType: "application/json", responseSchema: schema },
            });

            setResult(JSON.parse(response.text.trim()));
        } catch (e: any) {
            setError(`A análise de IA falhou. ${e.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="card p-6">
                <h2 className="text-xl font-bold text-slate-700 dark:text-slate-200">Revenue Management & Otimização</h2>
                
                <div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 my-6">
                    <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200 mb-1">Definir Período de Estudo</h3>
                    <p className="text-sm text-slate-500 mb-6">Analise a performance de um mês específico para planejar o ano seguinte.</p>
                    
                    <div className="flex flex-col sm:flex-row gap-4 items-end max-w-2xl">
                        <div className="w-full sm:w-1/3">
                            <label className="block text-xs font-medium text-slate-500 mb-1">Mês de Referência</label>
                            <select value={manualMonth} onChange={(e) => setManualMonth(Number(e.target.value))} className="w-full border border-slate-300 dark:border-slate-600 rounded-md p-2 text-sm dark:bg-slate-700 dark:text-slate-200">
                                {Array.from({length: 12}, (_, i) => (<option key={i+1} value={i+1}>{getMonthName(i+1)}</option>))}
                            </select>
                        </div>
                        <div className="w-full sm:w-1/4">
                            <label className="block text-xs font-medium text-slate-500 mb-1">Ano</label>
                            <select value={manualYear} onChange={(e) => setManualYear(Number(e.target.value))} className="w-full border border-slate-300 dark:border-slate-600 rounded-md p-2 text-sm dark:bg-slate-700 dark:text-slate-200">
                                <option value={new Date().getUTCFullYear() - 1}>{new Date().getUTCFullYear() - 1}</option>
                                <option value={new Date().getUTCFullYear()}>{new Date().getUTCFullYear()}</option>
                            </select>
                        </div>
                        <button onClick={handleManualMonthAnalyze} disabled={isLoading} className="bg-indigo-600 text-white px-6 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-70 text-sm font-semibold h-[38px] w-full sm:w-auto shadow-md flex items-center justify-center">
                            {isLoading ? 'Analisando...' : 'Gerar Estudo'}
                        </button>
                    </div>
                </div>

                <div className="border-t border-slate-100 dark:border-slate-700 pt-6">
                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-indigo-500" viewBox="0 0 20 20" fill="currentColor"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" /><path fillRule="evenodd" d="M4 5a2 2 0 012-2h2a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm10 4a2 2 0 012-2h2a2 2 0 012 2v6a2 2 0 01-2 2h-2a2 2 0 01-2-2V9z" clipRule="evenodd" /></svg>
                        Espelho de Performance Histórica ({getMonthName(manualMonth)} / {manualYear})
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {['201', '202', '301'].map(flat => {
                            const stats = historicalPerformance.stats[flat];
                            return (
                                <div key={flat} className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
                                    <div className="flex justify-between items-center mb-3">
                                        <span className="font-bold text-slate-700 dark:text-slate-300 uppercase text-xs tracking-wider">Apto. {flat}</span>
                                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${stats.occupancyRate > 50 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                                            {stats.occupancyRate > 0 ? 'COM DADOS' : 'SEM RESERVAS'}
                                        </span>
                                    </div>
                                    <div className="space-y-4">
                                        <div>
                                            <p className="text-xs text-slate-500 mb-1">MÉDIA DIÁRIA COBRADA</p>
                                            <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{formatCurrency(stats.adr)}</p>
                                        </div>
                                        <div>
                                            <div className="flex justify-between items-end mb-1">
                                                <p className="text-xs text-slate-500">OCUPAÇÃO DO MÊS</p>
                                                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{stats.occupancyRate.toFixed(1)}%</p>
                                            </div>
                                            <div className="w-full bg-slate-100 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                                                <div className="bg-indigo-500 h-full rounded-full transition-all duration-1000" style={{ width: `${stats.occupancyRate}%` }}></div>
                                            </div>
                                            <p className="text-[10px] text-slate-400 mt-1 uppercase font-bold text-right">
                                                {stats.occupiedNights.toFixed(0)} de {historicalPerformance.daysInMonth} dias ocupados
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {result && (
                <div className="space-y-6 animate-fade-in">
                    <div className="flex border-b border-slate-200 dark:border-slate-700 space-x-4 overflow-x-auto">
                        <button onClick={() => setActiveTab('prices')} className={`py-2 px-4 font-medium text-sm border-b-2 transition-colors whitespace-nowrap ${activeTab === 'prices' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Sugestão de Preços & Análise</button>
                        <button onClick={() => setActiveTab('packages')} className={`py-2 px-4 font-medium text-sm border-b-2 transition-colors whitespace-nowrap ${activeTab === 'packages' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Pacotes Criativos</button>
                        <button onClick={() => setActiveTab('scenarios')} className={`py-2 px-4 font-medium text-sm border-b-2 transition-colors whitespace-nowrap ${activeTab === 'scenarios' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Simulação de Cenários</button>
                    </div>

                    {activeTab === 'prices' && (
                        <div className="space-y-6">
                            <div className="card p-6">
                                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-2">Diagnóstico de Demanda e Mercado</h3>
                                <div className="prose prose-slate dark:prose-invert max-w-none text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                                    {result.lowSeasonAnalysis}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {result.pricingSuggestions.map((suggestion: PricingSuggestion) => (
                                    <div key={suggestion.flatId} className="card overflow-hidden border border-slate-200 dark:border-slate-700 flex flex-col shadow-sm">
                                        <div className="bg-slate-100 dark:bg-slate-700 p-3 text-center font-bold text-slate-700 dark:text-slate-200 uppercase tracking-tighter">Sugestão Apto {suggestion.flatId}</div>
                                        <div className="p-4 flex-grow space-y-4">
                                            <div className="grid grid-cols-2 gap-2 text-center">
                                                <div className="bg-blue-50 dark:bg-blue-900/20 p-2 rounded border border-blue-100 dark:border-blue-800">
                                                    <p className="text-[10px] text-blue-500 uppercase font-bold">SEG-QUI</p>
                                                    <p className="font-black text-xl text-blue-700 dark:text-blue-300">{formatCurrency(suggestion.suggestedRateWeekday)}</p>
                                                </div>
                                                <div className="bg-green-50 dark:bg-green-900/20 p-2 rounded border border-green-100 dark:border-green-800">
                                                    <p className="text-[10px] text-green-500 uppercase font-bold">SEX-DOM</p>
                                                    <p className="font-black text-xl text-green-700 dark:text-green-300">{formatCurrency(suggestion.suggestedRateWeekend)}</p>
                                                </div>
                                            </div>
                                            <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded text-xs text-slate-600 dark:text-slate-400 italic">
                                                <p className="font-bold mb-1 text-slate-800 dark:text-slate-200 not-italic">JUSTIFICATIVA:</p>
                                                "{suggestion.justification}"
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default DynamicPricingReport;
