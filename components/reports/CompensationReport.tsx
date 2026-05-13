
import React, { useState, useMemo, Dispatch, SetStateAction, useCallback, useEffect } from 'react';
import { Reservation, BankDeposit, MatchedPair, ManualConciliation, DismissedAutoMatch, UnifiedData, NfseRecord } from '../../types';
import { formatDate, formatCurrency, getMonthName } from '../../utils/helpers';
import { performAutoReconciliation } from '../../utils/reconciliation';
import { GoogleGenAI } from "@google/genai";

// Declare introJs to avoid TypeScript errors since it's loaded from a CDN
declare const introJs: any;

interface Props {
    reservations: Reservation[];
    deposits: BankDeposit[];
    selectedYear: number;
    selectedMonth: number;
    searchTerm: string;
    manualAdjustments: Record<string, number>;
    setManualAdjustments: Dispatch<SetStateAction<Record<string, number>>>;
    manualConciliations: ManualConciliation[];
    dismissedAutoMatches?: DismissedAutoMatch[];
    onDismissAutoMatch?: (reservationIds: string[], depositId: string) => void;
    unifiedData?: UnifiedData;
}

interface PlatformSummaryData {
    pendingRes: number;
    pendingResCount: number;
    unmatchedDep: number;
    unmatchedDepCount: number;
    balance: number;
}

const CompensationReport: React.FC<Props> = ({ reservations, deposits, selectedYear, selectedMonth, searchTerm, manualAdjustments, setManualAdjustments, manualConciliations, dismissedAutoMatches = [], onDismissAutoMatch, unifiedData = {} }) => {
    const [startTour, setStartTour] = useState(false);
    const [summaryScope, setSummaryScope] = useState<'all' | 'month'>('all');
    
    // AI State
    const [isAssistantOpen, setIsAssistantOpen] = useState(false);
    const [isAssistantLoading, setIsAssistantLoading] = useState(false);
    const [assistantError, setAssistantError] = useState<string | null>(null);
    const [assistantExplanation, setAssistantExplanation] = useState<string>('');

    useEffect(() => {
        if (startTour) {
            const intro = introJs();
            intro.setOptions({
                steps: [
                    {
                        element: '[data-tour-comp="title"]',
                        title: 'Conciliação de Compensação ⚖️',
                        intro: 'Este relatório cruza os dados das suas <strong>reservas</strong> com os <strong>depósitos bancários</strong> reais para garantir que você recebeu tudo o que deveria.',
                        position: 'bottom'
                    },
                    {
                        element: '[data-tour-comp="pending-lists"]',
                        title: '1. & 2. Listas de Pendências 📝',
                        intro: 'Detalha exatamente quais reservas estão sem pagamento e quais depósitos estão sobrando. Use isso para identificar atrasos ou adiantamentos.',
                        position: 'bottom'
                    },
                    {
                        element: '[data-tour-comp="history"]',
                        title: '3. Histórico de Conciliação ✅',
                        intro: 'Lista tudo que já foi conciliado neste mês, seja automaticamente pelo sistema ou manualmente por você.',
                        position: 'top'
                    },
                    {
                        element: '[data-tour-comp="summary"]',
                        title: '4. Resumo por Plataforma 📊',
                        intro: 'Aqui você vê o panorama final. <br/>Use o botão <strong>"Geral / Mês"</strong> para alternar entre ver todas as pendências acumuladas ou apenas os dados deste mês específico.',
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

    // 1. Reconciliation Logic
    const { allReservations, allDeposits, matchedPairs } = useMemo(() => {
        return performAutoReconciliation(reservations, deposits, manualAdjustments);
    }, [reservations, deposits, manualAdjustments]);

    // 1.5 Filter Dismissed Auto Matches
    const { finalMatchedPairs, dismissedResIds, dismissedDepIds } = useMemo(() => {
        const dismissedResIds = new Set<string>();
        const dismissedDepIds = new Set<string>();
        
        const finalMatchedPairs = matchedPairs.filter(pair => {
            const isDismissed = dismissedAutoMatches.some(d => 
                d.depositId === pair.deposit.id && 
                d.reservationIds.length === pair.reservations.length &&
                d.reservationIds.every(id => pair.reservations.some(r => r.id === id))
            );
            
            if (isDismissed) {
                pair.reservations.forEach(r => dismissedResIds.add(r.id));
                dismissedDepIds.add(pair.deposit.id);
                return false;
            }
            return true;
        });

        return { finalMatchedPairs, dismissedResIds, dismissedDepIds };
    }, [matchedPairs, dismissedAutoMatches]);

    // 2. Filter for Manual Conciliations (to exclude them from Pending lists)
    const manualResIds = useMemo(() => new Set(manualConciliations.flatMap(c => c.reservationIds)), [manualConciliations]);
    const manualDepIds = useMemo(() => new Set(manualConciliations.flatMap(c => c.depositIds)), [manualConciliations]);

    // 3. Lists Calculation
    const pendingReservations = useMemo(() => {
        return allReservations.filter(r => 
            (!r.matched || dismissedResIds.has(r.id)) && 
            !manualResIds.has(r.id) && 
            r.flat !== '301' && 
            r.platform !== 'Particular'
        ).sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime());
    }, [allReservations, manualResIds, dismissedResIds]);

    const unmatchedDeposits = useMemo(() => {
        return allDeposits.filter(d => 
            (!d.matched || dismissedDepIds.has(d.id)) && 
            !manualDepIds.has(d.id)
        ).sort((a, b) => a.date.getTime() - b.date.getTime());
    }, [allDeposits, manualDepIds, dismissedDepIds]);

    // 4. Platform Summary Calculation
    const platformSummary = useMemo(() => {
        const platforms = ['AIRBNB', 'BOOKING', 'DECOLAR'];
        const summary: Record<string, PlatformSummaryData> = {};

        platforms.forEach(p => summary[p] = { pendingRes: 0, pendingResCount: 0, unmatchedDep: 0, unmatchedDepCount: 0, balance: 0 });

        // Filter based on Scope
        let targetReservations = pendingReservations;
        let targetDeposits = unmatchedDeposits;

        if (summaryScope === 'month') {
            targetReservations = pendingReservations.filter(r => 
                r.checkIn.getUTCFullYear() === selectedYear && 
                r.checkIn.getUTCMonth() + 1 === selectedMonth
            );
            targetDeposits = unmatchedDeposits.filter(d => 
                d.date.getUTCFullYear() === selectedYear && 
                d.date.getUTCMonth() + 1 === selectedMonth
            );
        }

        targetReservations.forEach(r => {
            if (summary[r.platform]) {
                summary[r.platform].pendingRes += r.adjustedNet;
                summary[r.platform].pendingResCount += 1;
            }
        });

        targetDeposits.forEach(d => {
            let platform = '';
            const desc = d.description.toUpperCase();
            if (desc.includes('AIRBNB')) platform = 'AIRBNB';
            else if (desc.includes('BOOKING')) platform = 'BOOKING';
            else if (desc.includes('DECOLAR')) platform = 'DECOLAR';

            if (platform && summary[platform]) {
                summary[platform].unmatchedDep += d.amount;
                summary[platform].unmatchedDepCount += 1;
            }
        });

        Object.keys(summary).forEach(p => {
            summary[p].balance = summary[p].unmatchedDep - summary[p].pendingRes;
        });

        return summary;
    }, [pendingReservations, unmatchedDeposits, summaryScope, selectedYear, selectedMonth]);

    // 5. Reconciled History Calculation (Auto + Manual)
    const reconciledItems = useMemo(() => {
        const items: any[] = [];

        // Auto Matches
        finalMatchedPairs.forEach((pair, idx) => {
            const depositDate = pair.deposit.date;
            if (depositDate.getUTCFullYear() === selectedYear && depositDate.getUTCMonth() + 1 === selectedMonth) {
                items.push({
                    id: `auto-${idx}`,
                    type: 'Automática',
                    description: pair.deposit.description,
                    reservations: pair.reservations.map(r => r.guestName),
                    value: pair.deposit.amount,
                    date: depositDate,
                    autoMatchPair: pair
                });
            }
        });

        // Manual Matches
        // Deposits already have IDs now, no need to regenerate
        const allDepositsWithId = deposits; 
        
        manualConciliations.forEach((mc) => {
            const relatedDeposits = allDepositsWithId.filter(d => mc.depositIds.includes(d.id));
            // Find if any related deposit is in the selected month/year
            const relevantDeposit = relatedDeposits.find(d => 
                d.date.getUTCFullYear() === selectedYear && d.date.getUTCMonth() + 1 === selectedMonth
            );

            if (relevantDeposit) {
                const relatedReservations = reservations.filter(r => mc.reservationIds.includes(r.id));
                const totalValue = relatedDeposits.reduce((sum, d) => sum + d.amount, 0);
                
                items.push({
                    id: mc.id,
                    type: 'Manual',
                    description: relatedDeposits.map(d => d.description).join(' + '),
                    reservations: relatedReservations.map(r => r.guestName),
                    value: totalValue,
                    date: relevantDeposit.date
                });
            }
        });

        return items.sort((a, b) => b.date.getTime() - a.date.getTime());
    }, [finalMatchedPairs, manualConciliations, deposits, reservations, selectedYear, selectedMonth]);

    const handleAnalyzeWithAI = async () => {
        setIsAssistantOpen(true);
        setIsAssistantLoading(true);
        setAssistantError(null);
        setAssistantExplanation('');

        // Filter for specific month analysis (AI Focus)
        const monthlyPendingRes = pendingReservations.filter(r => 
            r.checkIn.getUTCFullYear() === selectedYear && 
            r.checkIn.getUTCMonth() + 1 === selectedMonth
        );

        const monthlyUnmatchedDep = unmatchedDeposits.filter(d => 
            d.date.getUTCFullYear() === selectedYear && 
            d.date.getUTCMonth() + 1 === selectedMonth
        );

        // Calculate summary for this specific month for the AI
        const monthlySummary: Record<string, PlatformSummaryData> = {};
        ['AIRBNB', 'BOOKING', 'DECOLAR'].forEach(p => monthlySummary[p] = { pendingRes: 0, pendingResCount: 0, unmatchedDep: 0, unmatchedDepCount: 0, balance: 0 });

        monthlyPendingRes.forEach(r => {
            if (monthlySummary[r.platform]) {
                monthlySummary[r.platform].pendingRes += r.adjustedNet;
                monthlySummary[r.platform].pendingResCount += 1;
            }
        });

        monthlyUnmatchedDep.forEach(d => {
            let platform = '';
            const desc = d.description.toUpperCase();
            if (desc.includes('AIRBNB')) platform = 'AIRBNB';
            else if (desc.includes('BOOKING')) platform = 'BOOKING';
            else if (desc.includes('DECOLAR')) platform = 'DECOLAR';

            if (platform && monthlySummary[platform]) {
                monthlySummary[platform].unmatchedDep += d.amount;
                monthlySummary[platform].unmatchedDepCount += 1;
            }
        });

        Object.keys(monthlySummary).forEach(p => {
            monthlySummary[p].balance = monthlySummary[p].unmatchedDep - monthlySummary[p].pendingRes;
        });

        const summaryText = Object.entries(monthlySummary)
            .map(([platform, data]: [string, PlatformSummaryData]) => 
                `- ${platform}: Esperado R$ ${formatCurrency(data.pendingRes)} (${data.pendingResCount} reservas), Recebido em Caixa (Não Conciliado) R$ ${formatCurrency(data.unmatchedDep)} (${data.unmatchedDepCount} depósitos). Saldo: R$ ${formatCurrency(data.balance)}.`
            ).join('\n');

        const prompt = `
            Você é um auditor financeiro especialista em aluguel por temporada.
            Analise a conciliação bancária do mês de ${getMonthName(selectedMonth)}/${selectedYear}.

            **FOCO:** A análise deve se concentrar EXCLUSIVAMENTE nas pendências deste mês específico.
            
            **Conceito:**
            *   **Esperado (Reservas Pendentes DESTE MÊS):** Reservas com check-in neste mês que o sistema ainda não conciliou.
            *   **Recebido (Depósitos Não Conciliados DESTE MÊS):** Dinheiro que entrou no banco neste mês e ainda não foi conciliado.
            *   **Saldo:** Diferença entre o que entrou (Recebido) e o que deveria ter entrado (Esperado) neste mês.

            **Dados do Mês (${getMonthName(selectedMonth)}/${selectedYear}):**
            ${summaryText}

            **Sua Tarefa:**
            Para cada plataforma (Airbnb, Booking, Decolar), analise a situação DO MÊS:
            1. **Saldo Equilibrado:** Se o saldo for próximo de zero, indique que as contas do mês batem.
            2. **Excesso de Recebimento:** Se houver muito "Recebido" e pouco "Esperado", sugira que podem ser pagamentos antecipados de meses futuros ou atrasados de meses passados caindo agora.
            3. **Falta de Recebimento:** Se houver muito "Esperado" e pouco "Recebido", alerte sobre possível atraso no repasse deste mês.

            Seja direto, profissional e use formatação Markdown (negrito) para os valores e conclusões.
        `;

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });

            setAssistantExplanation(response.text || "Não foi possível gerar a análise.");
        } catch (e: any) {
            console.error("Gemini API call failed:", e);
            setAssistantError(`A análise de IA falhou. Detalhe: ${e.message}`);
        } finally {
            setIsAssistantLoading(false);
        }
    };

    const handleDismissClick = (item: any) => {
        if (!onDismissAutoMatch || !item.autoMatchPair) return;

        // Check for NFS-e association
        let affectedNfse = false;
        const depositId = item.autoMatchPair.deposit.id;
        
        for (const key in unifiedData) {
            if (key.startsWith('nfseRecords-')) {
                const records = unifiedData[key] as Record<string, NfseRecord>;
                for (const recordId in records) {
                    if (records[recordId].depositId === depositId) {
                        affectedNfse = true;
                        break;
                    }
                }
            }
            if (affectedNfse) break;
        }

        let confirmMessage = 'Tem certeza que deseja desfazer esta conciliação automática?';
        if (affectedNfse) {
            confirmMessage = 'ATENÇÃO: Este depósito está associado a uma NFS-e. Desfazer a conciliação pode afetar os dados da nota fiscal. Deseja continuar?';
        }

        if (window.confirm(confirmMessage)) {
            const reservationIds = item.autoMatchPair.reservations.map((r: Reservation) => r.id);
            onDismissAutoMatch(reservationIds, depositId);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100" data-tour-comp="title">CONCILIAÇÃO DE COMPENSAÇÃO DE CAIXA</h2>
                    <button onClick={() => setStartTour(true)} title="Ajuda sobre este relatório" className="bg-blue-100 text-blue-700 p-2 rounded-full hover:bg-blue-200 transition-colors dark:bg-slate-700 dark:text-blue-300 dark:hover:bg-slate-600">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.546-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </button>
                    <button onClick={handleAnalyzeWithAI} title="Analisar conciliação com IA" className="bg-purple-100 text-purple-700 p-2 rounded-full hover:bg-purple-200 transition-colors dark:bg-slate-700 dark:text-purple-300 dark:hover:bg-slate-600">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Section 1 & 2: Pending Lists (Re-numbered to 1 & 2 since Summary moved to 4) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-tour-comp="pending-lists">
                
                {/* Hospedagens Pendentes */}
                <div className="card p-6 flex flex-col h-[500px]">
                    <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200 mb-4 flex items-center justify-between">
                        <span>1. HOSPEDAGENS COM DEPÓSITOS PENDENTES</span>
                        <span className="text-sm font-normal bg-red-100 text-red-800 px-2 py-1 rounded">{pendingReservations.length}</span>
                    </h3>
                    <div className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-900/50 rounded border border-slate-200 dark:border-slate-700">
                        <table className="min-w-full text-xs">
                            <thead className="bg-slate-100 dark:bg-slate-700 sticky top-0">
                                <tr>
                                    <th className="px-2 py-2 text-left">Hóspede / Flat</th>
                                    <th className="px-2 py-2 text-left">Check-in</th>
                                    <th className="px-2 py-2 text-right">Líquido</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pendingReservations.map(r => (
                                    <tr key={r.id} className="border-t border-slate-200 dark:border-slate-700">
                                        <td className="px-2 py-2">
                                            <div className="font-semibold">{r.guestName}</div>
                                            <div className="text-xs text-slate-500">{r.platform} - Flat {r.flat}</div>
                                        </td>
                                        <td className="px-2 py-2">{formatDate(r.checkIn)}</td>
                                        <td className="px-2 py-2 text-right font-mono">{formatCurrency(r.adjustedNet)}</td>
                                    </tr>
                                ))}
                                {pendingReservations.length === 0 && (
                                    <tr><td colSpan={3} className="text-center py-4 text-slate-500">Nenhuma reserva pendente.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Depósitos Não Conciliados */}
                <div className="card p-6 flex flex-col h-[500px]">
                    <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200 mb-4 flex items-center justify-between">
                        <span>2. DEPÓSITOS NÃO CONCILIADOS</span>
                        <span className="text-sm font-normal bg-blue-100 text-blue-800 px-2 py-1 rounded">{unmatchedDeposits.length}</span>
                    </h3>
                    <div className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-900/50 rounded border border-slate-200 dark:border-slate-700">
                        <table className="min-w-full text-xs">
                            <thead className="bg-slate-100 dark:bg-slate-700 sticky top-0">
                                <tr>
                                    <th className="px-2 py-2 text-left">Descrição</th>
                                    <th className="px-2 py-2 text-left">Data</th>
                                    <th className="px-2 py-2 text-right">Valor</th>
                                </tr>
                            </thead>
                            <tbody>
                                {unmatchedDeposits.map((d) => (
                                    <tr key={d.id} className="border-t border-slate-200 dark:border-slate-700">
                                        <td className="px-2 py-2 truncate max-w-[150px]" title={d.description}>{d.description}</td>
                                        <td className="px-2 py-2">{formatDate(d.date)}</td>
                                        <td className="px-2 py-2 text-right font-mono text-green-600 dark:text-green-400">{formatCurrency(d.amount)}</td>
                                    </tr>
                                ))}
                                {unmatchedDeposits.length === 0 && (
                                    <tr><td colSpan={3} className="text-center py-4 text-slate-500">Nenhum depósito pendente.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Section 3: History */}
            <div className="card p-6" data-tour-comp="history">
                <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200 mb-4">3. DEPÓSITOS CONCILIADOS VS. HOSPEDAGENS (HISTÓRICO)</h3>
                <div className="overflow-x-auto max-h-96">
                    <table className="min-w-full text-sm">
                        <thead className="bg-slate-100 dark:bg-slate-700 sticky top-0">
                            <tr>
                                <th className="px-4 py-2 text-left">Data Depósito</th>
                                <th className="px-4 py-2 text-center">Tipo</th>
                                <th className="px-4 py-2 text-left">Hóspede(s)</th>
                                <th className="px-4 py-2 text-left">Descrição Banco</th>
                                <th className="px-4 py-2 text-right">Valor</th>
                                <th className="px-4 py-2 text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {reconciledItems.map((item) => (
                                <tr key={item.id} className="border-t border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">
                                    <td className="px-4 py-2 whitespace-nowrap align-top">{formatDate(item.date)}</td>
                                    <td className="px-4 py-2 text-center align-top">
                                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${item.type === 'Automática' ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-purple-800'}`}>
                                            {item.type}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2 align-top">
                                        <div className="flex flex-col gap-1">
                                            {item.reservations.map((guest: string, i: number) => (
                                                <div key={i} className="text-sm font-medium">{guest}</div>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="px-4 py-2 max-w-xs truncate align-top" title={item.description}>{item.description}</td>
                                    <td className="px-4 py-2 text-right font-mono font-medium align-top">{formatCurrency(item.value)}</td>
                                    <td className="px-4 py-2 text-center align-top">
                                        {item.type === 'Automática' && onDismissAutoMatch && (
                                            <button 
                                                onClick={() => handleDismissClick(item)}
                                                className="text-red-500 hover:text-red-700 transition-colors"
                                                title="Desfazer Conciliação Automática"
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {reconciledItems.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                                        Nenhuma conciliação registrada neste mês.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Section 4: Resumo por Plataforma (Moved to Bottom) */}
            <div className="card p-6" data-tour-comp="summary">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
                    <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200">4. RESUMO POR PLATAFORMA</h3>
                    <div className="bg-slate-100 dark:bg-slate-700 p-1 rounded-lg flex text-sm">
                        <button 
                            onClick={() => setSummaryScope('all')}
                            className={`px-3 py-1.5 rounded-md transition-colors ${summaryScope === 'all' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-white shadow' : 'text-slate-500 dark:text-slate-400'}`}
                        >
                            Visão Geral (Tudo)
                        </button>
                        <button 
                            onClick={() => setSummaryScope('month')}
                            className={`px-3 py-1.5 rounded-md transition-colors ${summaryScope === 'month' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-white shadow' : 'text-slate-500 dark:text-slate-400'}`}
                        >
                            Apenas Mês Selecionado
                        </button>
                    </div>
                </div>
                
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-slate-100 dark:bg-slate-700">
                            <tr>
                                <th className="px-4 py-2 text-left">Plataforma</th>
                                <th className="px-4 py-2 text-right">Reservas Pendentes (R$)</th>
                                <th className="px-4 py-2 text-right">Depósitos Não Conciliados (R$)</th>
                                <th className="px-4 py-2 text-right">Saldo (Sobra de Caixa)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(platformSummary).map(([platform, value]) => {
                                const data = value as PlatformSummaryData;
                                return (
                                    <tr key={platform} className="border-t border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">
                                        <td className="px-4 py-3 font-semibold">{platform}</td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="font-mono text-slate-700 dark:text-slate-200">{formatCurrency(data.pendingRes)}</div>
                                            <div className="text-xs text-slate-500">({data.pendingResCount} itens)</div>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="font-mono text-slate-700 dark:text-slate-200">{formatCurrency(data.unmatchedDep)}</div>
                                            <div className="text-xs text-slate-500">({data.unmatchedDepCount} itens)</div>
                                        </td>
                                        <td className={`px-4 py-3 text-right font-bold ${data.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {formatCurrency(data.balance)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {summaryScope === 'month' && (
                    <p className="text-xs text-slate-500 mt-2 italic">* Exibindo apenas pendências e depósitos com data dentro do mês de {getMonthName(selectedMonth)}.</p>
                )}
            </div>

            {isAssistantOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4" onClick={() => setIsAssistantOpen(false)}>
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-700 pb-3 mb-4">
                            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                                </svg>
                                Assistente IA: Análise de Conciliação
                            </h2>
                            <button onClick={() => setIsAssistantOpen(false)} className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white text-3xl font-light">&times;</button>
                        </div>
                        <div className="overflow-y-auto">
                            {isAssistantLoading && (
                                <div className="flex flex-col items-center justify-center p-8">
                                    <div className="loader ease-linear rounded-full border-4 border-t-4 border-gray-200 h-12 w-12 mb-4 animate-spin" style={{borderTopColor: '#8b5cf6'}}></div>
                                    <p className="mt-4 text-slate-600 dark:text-slate-300">Analisando divergências de caixa...</p>
                                </div>
                            )}
                            {assistantError && (
                                <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-md">
                                    <p className="font-semibold text-red-700 dark:text-red-300">Ocorreu um erro</p>
                                    <p className="text-sm text-red-600 dark:text-red-400">{assistantError}</p>
                                </div>
                            )}
                            {!isAssistantLoading && assistantExplanation && (
                                <div className="prose prose-slate dark:prose-invert max-w-none whitespace-pre-wrap p-2 text-slate-700 dark:text-slate-200"
                                     dangerouslySetInnerHTML={{ __html: assistantExplanation.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br />') }}
                                >
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CompensationReport;
