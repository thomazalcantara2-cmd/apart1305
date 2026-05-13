
import React, { useMemo, useState, useEffect } from 'react';
import { BankDeposit, FinancialData, UnifiedData, Reservation, ManualConciliation } from '../../types';
import { formatCurrency, getMonthName, formatDate, exportToExcel, sanitizePdfText } from '../../utils/helpers';
import { performAutoReconciliation } from '../../utils/reconciliation';
import { GoogleGenAI } from "@google/genai";

// Declare introJs to avoid TypeScript errors since it's loaded from a CDN
declare const introJs: any;

interface Props {
    reservations: Reservation[];
    deposits: BankDeposit[];
    unifiedData: UnifiedData;
    selectedYear: number;
    selectedMonth: number;
    searchTerm: string;
    manualAdjustments: Record<string, number>;
    carneLeaoData: { [year: number]: any[] };
    manualConciliations: ManualConciliation[];
}

const CarneLeaoReport: React.FC<Props> = ({ reservations, deposits, unifiedData, selectedYear, selectedMonth, searchTerm, manualAdjustments, carneLeaoData, manualConciliations }) => {
    const [startTour, setStartTour] = useState(false);
    const [isAssistantOpen, setIsAssistantOpen] = useState(false);
    const [isAssistantLoading, setIsAssistantLoading] = useState(false);
    const [assistantError, setAssistantError] = useState<string | null>(null);
    const [assistantExplanation, setAssistantExplanation] = useState<string>('');
    const [showExpenseDetails, setShowExpenseDetails] = useState(false);

    const expenseKeyMapping: { [key: string]: string } = {
        'condominio': 'Condomínio 201',
        'taxaExtra': 'Taxa Extra 201',
        'energia': 'Energia 201',
        'iptu': 'IPTU 201',
        'condominio202': 'Condomínio 202',
        'taxaExtra202': 'Taxa Extra 202',
        'energia202': 'Energia 202',
        'iptu202': 'IPTU 202',
    };

    const calculationData = useMemo(() => carneLeaoData[selectedYear] || [], [carneLeaoData, selectedYear]);

    // Detecta o regime pelos dados do ano selecionado.
    // Se o primeiro registro tiver rbt12 definido, é Simples Nacional.
    // Caso contrário, é Carnê Leão. Isso evita hardcode de ano nos componentes.
    const isSimples = useMemo(() => {
        const first = calculationData[0];
        return first !== undefined && 'rbt12' in first;
    }, [calculationData]);

    const regimeLabel = isSimples ? 'Simples Nacional' : 'Carnê Leão';
    const regimeFileLabel = isSimples ? 'Simples_Nacional' : 'Carne_Leao';

    useEffect(() => {
        if (startTour) {
            const intro = introJs();
            const regimeName = regimeLabel;
            intro.setOptions({
                steps: [
                    {
                        element: '[data-tour-carne="title"]',
                        title: `Relatório ${regimeName} 🏢`,
                        intro: `Este relatório calcula o <strong>imposto mensal (${regimeName})</strong> devido sobre os aluguéis.`,
                        position: 'bottom'
                    },
                    {
                        element: '[data-tour-carne="monthly-summary"]',
                        title: 'Resumo do Mês 🧾',
                        intro: 'Aqui você vê o cálculo <strong>detalhado</strong> para o mês selecionado.',
                        position: 'top'
                    },
                    {
                        element: '[data-tour-carne="revenue-details"]',
                        title: 'Detalhamento da Receita 🏦',
                        intro: 'Esta tabela lista todos os <strong>depósitos bancários</strong> que compõem a receita do mês. A coluna "Hóspede Associado" tenta identificar a origem do depósito automaticamente.',
                        position: 'top'
                    },
                    {
                        element: '[data-tour-carne="yearly-summary"]',
                        title: 'Resumo Anual 🗓️',
                        intro: 'Acompanhe o <strong>desempenho mês a mês</strong> ao longo do ano. A linha amarela destaca o mês que você está visualizando atualmente.',
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
    }, [startTour, selectedYear, regimeLabel]);
    
    const currentMonthData = useMemo(() => {
        if (selectedMonth === 0) {
            return {
                month: 0,
                revenue: calculationData.reduce((s, d) => s + d.revenue, 0),
                expenses: calculationData.reduce((s, d) => s + d.expenses, 0),
                creditUsed: calculationData.reduce((s, d) => s + d.creditUsed, 0),
                calculationBase: calculationData.reduce((s, d) => s + d.calculationBase, 0),
                taxDue: calculationData.reduce((s, d) => s + d.taxDue, 0),
                excessCarryover: calculationData.length > 0 ? calculationData[calculationData.length - 1].excessCarryover : 0,
                expenseDetails: {}
            };
        }
        return calculationData.find(d => d.month === selectedMonth);
    }, [calculationData, selectedMonth]);

    const allMatchedPairs = useMemo(() => {
        return performAutoReconciliation(reservations, deposits, manualAdjustments).matchedPairs;
    }, [reservations, deposits, manualAdjustments]);


    const monthlyDepositsWithGuest = useMemo(() => {
        const depositMatchMap = new Map<string, Reservation[]>();
        allMatchedPairs.forEach(pair => {
            const depositId = pair.deposit.id;
            depositMatchMap.set(depositId, pair.reservations);
        });

        const manualMatchMap = new Map<string, Reservation[]>();
        manualConciliations.forEach(mc => {
             const relatedReservations = reservations.filter(r => mc.reservationIds.includes(r.id));
             mc.depositIds.forEach(dId => {
                 manualMatchMap.set(dId, relatedReservations);
             });
        });

        const filteredDeposits = deposits.filter(d => {
            const yearMatch = d.date.getUTCFullYear() === selectedYear;
            const monthMatch = selectedMonth === 0 || d.date.getUTCMonth() + 1 === selectedMonth;
            return yearMatch && monthMatch;
        });

        return filteredDeposits.map(deposit => {
            let associatedGuest = '-';
            const manualMatch = manualMatchMap.get(deposit.id);
            if (manualMatch && manualMatch.length > 0) {
                 associatedGuest = manualMatch.map(r => r.guestName).join(' + ') + ' (Manual)';
            } else {
                const matchedReservations = depositMatchMap.get(deposit.id);
                if (matchedReservations && matchedReservations.length > 0) {
                    associatedGuest = matchedReservations.map(r => r.guestName).join(' + ');
                } else {
                    const depositDesc = deposit.description.toUpperCase();
                    for (const res of reservations) { 
                        const guestNameParts = res.guestName.split(' ').filter(p => p.length > 2);
                        if (guestNameParts.length > 1) {
                            const matchCount = guestNameParts.reduce((count, part) => {
                                return depositDesc.includes(part) ? count + 1 : count;
                            }, 0);
                            if (matchCount >= 2) {
                                associatedGuest = res.guestName;
                                break;
                            }
                        }
                    }
                }
            }
            return { ...deposit, associatedGuest };
        });
    }, [deposits, reservations, selectedYear, selectedMonth, allMatchedPairs, manualConciliations]);

    const filteredMonthlyDeposits = useMemo(() => {
        if (!searchTerm) return monthlyDepositsWithGuest;
        const lowercasedFilter = searchTerm.toLowerCase();
        return monthlyDepositsWithGuest.filter(dep => 
           dep.description.toLowerCase().includes(lowercasedFilter) ||
           dep.associatedGuest.toLowerCase().includes(lowercasedFilter) ||
           formatCurrency(dep.amount).includes(lowercasedFilter)
        );
   }, [monthlyDepositsWithGuest, searchTerm]);

    const monthlyNfse = useMemo(() => {
        const nfseRecordsObj = (unifiedData['nfseRecords'] as Record<string, any>) || {};
        return Object.values(nfseRecordsObj).filter(r => 
            r.competenceYear === selectedYear && 
            (selectedMonth === 0 || r.competenceMonth === selectedMonth)
        );
    }, [unifiedData, selectedYear, selectedMonth]);

    const filteredMonthlyNfse = useMemo(() => {
        if (!searchTerm) return monthlyNfse;
        const lowercasedFilter = searchTerm.toLowerCase();
        return monthlyNfse.filter(nfse => 
            String(nfse.id || '').toLowerCase().includes(lowercasedFilter) ||
            String(nfse.loteNumber || '').toLowerCase().includes(lowercasedFilter) ||
            formatCurrency(nfse.grossValue || 0).includes(lowercasedFilter)
        );
    }, [monthlyNfse, searchTerm]);

    const handleExportExcel = () => {
        if (selectedMonth === 0) {
            const data = calculationData.map(d => {
                const row: any = {
                    'Mês': getMonthName(d.month).toUpperCase(),
                    'Receita': d.revenue,
                };
                if (isSimples) {
                    row['RBT12'] = d.rbt12;
                    row['Alíquota Efetiva (%)'] = ((d.effectiveRate || 0) * 100).toFixed(2);
                } else {
                    row['Despesas'] = d.expenses;
                    row['Base de Cálculo'] = d.calculationBase;
                }
                row['Imposto Devido'] = d.taxDue;
                return row;
            });
            
            const totalRevenue = calculationData.reduce((s, d) => s + d.revenue, 0);
            const totalTaxDue = calculationData.reduce((s, d) => s + d.taxDue, 0);
            
            data.push({} as any);
            const totalRow: any = {
                'Mês': 'TOTAL ACUMULADO',
                'Receita': totalRevenue,
            };
            if (isSimples) {
                totalRow['RBT12'] = '-';
                totalRow['Alíquota Efetiva (%)'] = '-';
            } else {
                totalRow['Despesas'] = calculationData.reduce((s, d) => s + d.expenses, 0);
                totalRow['Base de Cálculo'] = calculationData.reduce((s, d) => s + d.calculationBase, 0);
            }
            totalRow['Imposto Devido'] = totalTaxDue;

            data.push(totalRow);
            exportToExcel(`${regimeFileLabel}_Exercício_${selectedYear}`, data);
        } else {
            if (isSimples) {
                const data = filteredMonthlyNfse.map(d => ({
                    'RPS / ID': d.id,
                    'Competência': `${String(d.competenceMonth).padStart(2, '0')}/${d.competenceYear}`,
                    'Valor Bruto': d.grossValue
                }));
                exportToExcel(`${regimeFileLabel}_Detalhes_${getMonthName(selectedMonth)}_${selectedYear}`, data);
            } else {
                const data = filteredMonthlyDeposits.map(d => ({
                    'Data': formatDate(d.date),
                    'Descrição': d.description,
                    'Hóspede Associado': d.associatedGuest,
                    'Valor': d.amount
                }));
                exportToExcel(`${regimeFileLabel}_Detalhes_${getMonthName(selectedMonth)}_${selectedYear}`, data);
            }
        }
    };

    const handleExportPdf = () => {
        const doc = new (window as any).jspdf.jsPDF();
        if (selectedMonth === 0) {
            doc.text(`Relatório ${regimeLabel} - Exercício ${selectedYear}`, 14, 16);
            
            const headers = isSimples 
                ? [["Mês", "Receita", "RBT12", "Alíquota Efetiva", "Imposto Devido"]]
                : [["Mês", "Receita", "Despesas", "Base de Cálculo", "Imposto Devido"]];
                
            const data = calculationData.map(d => {
                if (isSimples) {
                    return [
                        getMonthName(d.month).toUpperCase(),
                        formatCurrency(d.revenue),
                        formatCurrency(d.rbt12 || 0),
                        `${((d.effectiveRate || 0) * 100).toFixed(2)}%`,
                        formatCurrency(d.taxDue)
                    ];
                } else {
                    return [
                        getMonthName(d.month).toUpperCase(),
                        formatCurrency(d.revenue),
                        formatCurrency(d.expenses),
                        formatCurrency(d.calculationBase),
                        formatCurrency(d.taxDue)
                    ];
                }
            });
            
            const totals = isSimples 
                ? [
                    'TOTAL',
                    formatCurrency(calculationData.reduce((s, d) => s + d.revenue, 0)),
                    '-',
                    '-',
                    formatCurrency(calculationData.reduce((s, d) => s + d.taxDue, 0)),
                ]
                : [
                    'TOTAL',
                    formatCurrency(calculationData.reduce((s, d) => s + d.revenue, 0)),
                    formatCurrency(calculationData.reduce((s, d) => s + d.expenses, 0)),
                    formatCurrency(calculationData.reduce((s, d) => s + d.calculationBase, 0)),
                    formatCurrency(calculationData.reduce((s, d) => s + d.taxDue, 0)),
                ];
                
            (doc as any).autoTable({
                startY: 25, head: headers, body: data, foot: [totals],
                theme: 'grid', styles: { fontSize: 8 },
                headStyles: { fillColor: [44, 62, 80] },
                footStyles: { fillColor: [44, 62, 80], textColor: [255, 255, 255], fontStyle: 'bold' },
                didParseCell: (d: any) => { if (d.column.index > 0) d.cell.styles.halign = 'right'; }
            });
            doc.save(`${regimeFileLabel}_Anual_${selectedYear}.pdf`);
        } else {
            doc.text(`${regimeLabel} - ${getMonthName(selectedMonth)}/${selectedYear}`, 14, 16);
            doc.setFontSize(10);
            doc.text(`Receita Bruta: ${formatCurrency(currentMonthData?.revenue || 0)}`, 14, 25);
            if (isSimples) {
                doc.text(`RBT12: ${formatCurrency(currentMonthData?.rbt12 || 0)}`, 14, 30);
                doc.text(`Alíquota Efetiva: ${((currentMonthData?.effectiveRate || 0) * 100).toFixed(2)}%`, 14, 35);
                doc.text(`Imposto Devido: ${formatCurrency(currentMonthData?.taxDue || 0)}`, 14, 40);
            } else {
                doc.text(`Despesas Dedutíveis: ${formatCurrency(currentMonthData?.expenses || 0)}`, 14, 30);
                doc.text(`Base de Cálculo: ${formatCurrency(currentMonthData?.calculationBase || 0)}`, 14, 35);
                doc.text(`Imposto Devido: ${formatCurrency(currentMonthData?.taxDue || 0)}`, 14, 40);
            }
            let headers, body;
            if (isSimples) {
                headers = [["RPS / ID", "Competência", "Valor Bruto"]];
                body = filteredMonthlyNfse.map(d => [d.id, `${String(d.competenceMonth).padStart(2, '0')}/${d.competenceYear}`, formatCurrency(d.grossValue || 0)]);
            } else {
                headers = [["Data", "Descrição", "Hóspede", "Valor"]];
                body = filteredMonthlyDeposits.map(d => [formatDate(d.date), sanitizePdfText(d.description), sanitizePdfText(d.associatedGuest), formatCurrency(d.amount)]);
            }
            
            (doc as any).autoTable({
                startY: 45, head: headers, body: body, theme: 'grid', styles: { fontSize: 8 }
            });
            doc.save(`${regimeFileLabel}_${getMonthName(selectedMonth)}_${selectedYear}.pdf`);
        }
    };

    const handleAnalyzeWithAI = async () => {
        if (!currentMonthData) return;
        setIsAssistantOpen(true);
        setIsAssistantLoading(true);
        setAssistantError(null);
        setAssistantExplanation('');
        const periodName = selectedMonth === 0 ? `o ano de ${selectedYear}` : `${getMonthName(selectedMonth)}/${selectedYear}`;
        const regimeNameTitle = isSimples ? "Simples Nacional (Anexo III - LC 123/2006)" : "Carnê Leão";
        const prompt = `Explique o ${regimeNameTitle} para ${periodName}: Receita ${formatCurrency(currentMonthData.revenue)}, ${isSimples ? `RBT12 ${formatCurrency(currentMonthData.rbt12 || 0)}, Alíquota ${(currentMonthData.effectiveRate * 100).toFixed(2)}%` : `Despesas ${formatCurrency(currentMonthData.expenses)}, Base ${formatCurrency(currentMonthData.calculationBase)}`}, Imposto ${formatCurrency(currentMonthData.taxDue)}. ${selectedMonth === 0 ? 'Esta é uma visão ANUAL.' : ''} Seja didático e use negrito.`;
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
            setAssistantExplanation(response.text);
        } catch (e: any) {
            setAssistantError(`IA falhou: ${e.message}`);
        } finally {
            setIsAssistantLoading(false);
        }
    };

    const reportTitle = selectedMonth === 0 ? `${regimeLabel.toUpperCase()} - EXERCÍCIO COMPLETO ${selectedYear}` : `${regimeLabel.toUpperCase()} - ${getMonthName(selectedMonth).toUpperCase()}/${selectedYear}`;

    return (
        <div className="space-y-6">
            <div className="card p-6">
                <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-4 mb-4">
                     <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-xl font-bold text-slate-700 dark:text-slate-200" data-tour-carne="title">{reportTitle}</h2>
                        <button onClick={() => setStartTour(true)} className="bg-blue-100 text-blue-700 p-2 rounded-full hover:bg-blue-200 transition-colors dark:bg-slate-700 dark:text-blue-300">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.546-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </button>
                        <button onClick={handleAnalyzeWithAI} className="bg-purple-100 text-purple-700 p-2 rounded-full hover:bg-purple-200 transition-colors dark:bg-slate-700">
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                       </button>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        <button onClick={handleExportPdf} title="Exportar Relatório Atual (PDF)" className="bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors text-sm font-bold flex items-center gap-2 shadow-sm">
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            Baixar {selectedMonth === 0 ? 'Ano' : 'Mês'} (PDF)
                        </button>
                        <button onClick={handleExportExcel} title="Exportar Relatório Atual (Excel)" className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 transition-colors text-sm font-bold flex items-center gap-2 shadow-sm">
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                            Baixar {selectedMonth === 0 ? 'Ano' : 'Mês'} (XLS)
                        </button>
                    </div>
                </div>
                <div className="overflow-x-auto" data-tour-carne="monthly-summary">
                    <table className="min-w-full">
                        <thead><tr><th>Descrição</th><th className="text-right">Valor</th></tr></thead>
                        <tbody>
                            <tr>
                                <td>Receita {selectedMonth === 0 ? 'Anual' : ''} {isSimples ? '(NFS-e Emitidas)' : '(Depósitos)'}</td>
                                <td className="text-right">{formatCurrency(currentMonthData?.revenue || 0)}</td>
                            </tr>
                            
                            {isSimples ? (
                                <>
                                    <tr>
                                        <td>Receita Bruta Acumulada 12 meses (RBT12)</td>
                                        <td className="text-right text-slate-600">{formatCurrency(currentMonthData?.rbt12 || 0)}</td>
                                    </tr>
                                    <tr>
                                        <td>Alíquota Efetiva</td>
                                        <td className="text-right text-slate-600">
                                            {((currentMonthData?.effectiveRate || 0) * 100).toFixed(2)}%
                                        </td>
                                    </tr>
                                    <tr className="font-semibold">
                                        <td>Base de Cálculo (Receita do {selectedMonth === 0 ? 'Ano' : 'Mês'})</td>
                                        <td className="text-right">{formatCurrency(currentMonthData?.calculationBase || 0)}</td>
                                    </tr>
                                    <tr className="font-bold bg-blue-50 dark:bg-blue-900/20">
                                        <td>Imposto Devido {selectedMonth === 0 ? 'Acumulado' : ''} (Simples Nacional)</td>
                                        <td className="text-right text-blue-600">{formatCurrency(currentMonthData?.taxDue || 0)}</td>
                                    </tr>
                                </>
                            ) : (
                                <>
                                    <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                        <td className="flex items-center">
                                            {selectedMonth !== 0 && (
                                                <button onClick={() => setShowExpenseDetails(!showExpenseDetails)} className="mr-2 text-blue-500 font-mono text-lg">{showExpenseDetails ? '−' : '+'}</button>
                                            )}
                                            Despesas Dedutíveis
                                        </td>
                                        <td className="text-right">{formatCurrency(currentMonthData?.expenses || 0)}</td>
                                    </tr>
                                    {showExpenseDetails && selectedMonth !== 0 && currentMonthData?.expenseDetails && Object.entries(currentMonthData.expenseDetails).map(([key, value]) => (
                                        <tr key={key} className="bg-slate-50 dark:bg-slate-900/50">
                                            <td className="pl-10 text-sm text-slate-600 dark:text-slate-400">{expenseKeyMapping[key] || key}</td>
                                            <td className="text-right text-sm text-slate-600 dark:text-slate-400">{formatCurrency(value as number)}</td>
                                        </tr>
                                    ))}
                                    <tr><td>Crédito Utilizado (Anterior)</td><td className="text-right text-green-600">{formatCurrency(currentMonthData?.creditUsed || 0)}</td></tr>
                                    <tr className="font-semibold"><td>Base de Cálculo {selectedMonth === 0 ? 'Anual' : ''}</td><td className="text-right">{formatCurrency(currentMonthData?.calculationBase || 0)}</td></tr>
                                    <tr className="font-bold bg-blue-50 dark:bg-blue-900/20"><td>Imposto Devido {selectedMonth === 0 ? 'Acumulado' : ''}</td><td className="text-right text-blue-600">{formatCurrency(currentMonthData?.taxDue || 0)}</td></tr>
                                    <tr className="font-bold"><td className="text-red-600">Excesso de Despesa (Crédito para Próximo Período)</td><td className="text-right">{formatCurrency(currentMonthData?.excessCarryover || 0)}</td></tr>
                                </>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            
            <div className="card p-6" data-tour-carne="revenue-details">
                <h2 className="text-xl font-bold text-slate-700 dark:text-slate-200 mb-4 uppercase">Detalhamento das Receitas {isSimples ? '(NFS-e Emitidas)' : '(Banco)'} - {selectedMonth === 0 ? 'Ano Completo' : 'Mês Selecionado'}</h2>
                 <div className="overflow-x-auto max-h-[500px]">
                    <table className="min-w-full">
                        <thead className="sticky top-0">
                            {isSimples ? (
                                <tr><th>RPS / ID</th><th>Competência</th><th>Plataforma</th><th className="text-right">Valor Bruto</th></tr>
                            ) : (
                                <tr><th>Data</th><th>Descrição</th><th>Hóspede Associado</th><th className="text-right">Valor</th></tr>
                            )}
                        </thead>
                        <tbody>
                            {isSimples ? (
                                filteredMonthlyNfse.map((nfse, index) => (
                                    <tr key={index}>
                                        <td>{nfse.id || nfse.loteNumber || '-'}</td>
                                        <td>{String(nfse.competenceMonth).padStart(2, '0')}/{nfse.competenceYear}</td>
                                        <td>{nfse.platform || '-'}</td>
                                        <td className="text-right">{formatCurrency(nfse.grossValue || 0)}</td>
                                    </tr>
                                ))
                            ) : (
                                filteredMonthlyDeposits.map((dep, index) => (
                                    <tr key={index}><td>{formatDate(dep.date)}</td><td>{dep.description}</td><td>{dep.associatedGuest}</td><td className="text-right">{formatCurrency(dep.amount)}</td></tr>
                                ))
                            )}
                            
                            {isSimples && filteredMonthlyNfse.length === 0 && (
                                <tr><td colSpan={4} className="py-4 px-4 text-center text-slate-500">Nenhuma nota fiscal emitida.</td></tr>
                            )}
                            
                            {!isSimples && filteredMonthlyDeposits.length === 0 && (
                                <tr><td colSpan={4} className="py-4 px-4 text-center text-slate-500">Nenhum depósito.</td></tr>
                            )}
                        </tbody>
                         <tfoot className="bg-slate-100 dark:bg-slate-800 font-bold sticky bottom-0">
                            <tr>
                                <td colSpan={3} className="py-2 px-4 text-right uppercase">Total Receitas:</td>
                                <td className="py-2 px-4 text-right">{formatCurrency(currentMonthData?.revenue || 0)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>

            <div className="card p-6" data-tour-carne="yearly-summary">
                <h2 className="text-xl font-bold text-slate-700 dark:text-slate-200 mb-4">{`RESUMO ACUMULADO DO EXERCÍCIO (${selectedYear})`}</h2>
                <div className="overflow-x-auto max-h-96">
                    <table className="min-w-full">
                        <thead className="sticky top-0">
                            {isSimples ? (
                                <tr><th>Mês</th><th className="text-right">Receita</th><th className="text-right">RBT12</th><th className="text-right">Alíquota Efetiva</th><th className="text-right">Imposto Simples</th></tr>
                            ) : (
                                <tr><th>Mês</th><th className="text-right">Receita</th><th className="text-right">Despesas</th><th className="text-right">Base de Cálculo</th><th className="text-right">Imposto Devido</th></tr>
                            )}
                        </thead>
                        <tbody>
                             {calculationData.map((data) => (
                                 <tr key={data.month} className={data.month === selectedMonth ? 'bg-yellow-100 dark:bg-yellow-900/20' : ''}>
                                     <td>{getMonthName(data.month).toUpperCase()}</td>
                                     <td className="text-right">{formatCurrency(data.revenue)}</td>
                                     {isSimples ? (
                                         <>
                                             <td className="text-right text-slate-500">{formatCurrency(data.rbt12 || 0)}</td>
                                             <td className="text-right text-slate-500">{((data.effectiveRate || 0) * 100).toFixed(2)}%</td>
                                         </>
                                     ) : (
                                         <>
                                             <td className="text-right text-slate-500">{formatCurrency(data.expenses)}</td>
                                             <td className="text-right text-slate-500">{formatCurrency(data.calculationBase)}</td>
                                         </>
                                     )}
                                     <td className="text-right font-semibold text-blue-600">{formatCurrency(data.taxDue)}</td>
                                 </tr>
                             ))}
                        </tbody>
                         <tfoot className="bg-slate-800 text-white font-bold sticky bottom-0">
                            <tr>
                                <td className="py-2 px-4">TOTAL</td>
                                <td className="py-2 px-4 text-right">{formatCurrency(calculationData.reduce((s, d) => s + d.revenue, 0))}</td>
                                {isSimples ? (
                                    <>
                                        <td className="py-2 px-4 text-right">-</td>
                                        <td className="py-2 px-4 text-right">-</td>
                                    </>
                                ) : (
                                    <>
                                        <td className="py-2 px-4 text-right">{formatCurrency(calculationData.reduce((s, d) => s + d.expenses, 0))}</td>
                                        <td className="py-2 px-4 text-right">{formatCurrency(calculationData.reduce((s, d) => s + d.calculationBase, 0))}</td>
                                    </>
                                )}
                                <td className="py-2 px-4 text-right">{formatCurrency(calculationData.reduce((s, d) => s + d.taxDue, 0))}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
             {isAssistantOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4" onClick={() => setIsAssistantOpen(false)}>
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-700 pb-3 mb-4">
                            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">Assistente IA</h2>
                            <button onClick={() => setIsAssistantOpen(false)} className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white text-3xl font-light">&times;</button>
                        </div>
                        <div className="overflow-y-auto">
                            {isAssistantLoading && <div className="flex flex-col items-center justify-center p-8"><div className="loader ease-linear rounded-full border-4 border-t-4 border-gray-200 h-12 w-12 mb-4 animate-spin" style={{borderTopColor: '#8b5cf6'}}></div><p className="mt-4 text-slate-600 dark:text-slate-300">Analisando...</p></div>}
                            {assistantError && <div className="p-4 bg-red-50 rounded-md"><p className="text-sm text-red-600">{assistantError}</p></div>}
                            {!isAssistantLoading && assistantExplanation && <div className="prose prose-slate dark:prose-invert max-w-none whitespace-pre-wrap p-2 text-slate-700 dark:text-slate-200" dangerouslySetInnerHTML={{ __html: assistantExplanation.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br />') }}></div>}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CarneLeaoReport;
