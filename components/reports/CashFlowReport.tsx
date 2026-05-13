
import React, { useMemo, useState } from 'react';
import { BankDeposit, Reservation, UnifiedData, FinancialData, CleaningData, ManualConciliation } from '../../types';
import { formatCurrency, getMonthName, formatDate, exportToPdf } from '../../utils/helpers';
import { performAutoReconciliation } from '../../utils/reconciliation';
import { CONDOMINIO_201_FIXED, CONDOMINIO_202_FIXED } from '../../constants';

interface Props {
    deposits: BankDeposit[];
    reservations: Reservation[];
    unifiedData: UnifiedData;
    manualAdjustments: Record<string, number>;
    selectedYear: number;
    selectedMonth: number;
    searchTerm: string;
    carneLeaoData: { [year: number]: any[] };
    manualConciliations: ManualConciliation[];
}

const CashFlowReport: React.FC<Props> = ({ deposits, reservations, unifiedData, manualAdjustments, selectedYear, selectedMonth, searchTerm, carneLeaoData, manualConciliations }) => {
    const [showExpenseDetails, setShowExpenseDetails] = useState(false);
    const availableFlats = useMemo(() => ['201', '202', '301'], []);
    const [selectedFlats, setSelectedFlats] = useState<string[]>(['201', '202']);

    const handleFlatSelectionChange = (flat: string) => {
        setSelectedFlats(prev =>
            prev.includes(flat)
                ? prev.filter(f => f !== flat)
                : [...prev, flat]
        );
    };

    // 1. Calculate Matches
    const allMatchedPairs = useMemo(() => {
        return performAutoReconciliation(reservations || [], deposits || [], manualAdjustments || {}).matchedPairs;
    }, [reservations, deposits, manualAdjustments]);

    // 2. Revenue processing - Baseada estritamente em Depósitos
    const { monthlyDeposits, totalRevenue } = useMemo(() => {
        const depositMatchMap = new Map<string, Reservation[]>();
        (allMatchedPairs || []).forEach(pair => {
            depositMatchMap.set(pair.deposit.id, pair.reservations);
        });

        const manualMatchMap = new Map<string, Reservation[]>();
        (manualConciliations || []).forEach(mc => {
             const relatedReservations = (reservations || []).filter(r => mc.reservationIds.includes(r.id));
             mc.depositIds.forEach(dId => {
                 manualMatchMap.set(dId, relatedReservations);
             });
        });

        const monthlyAll = (deposits || []).filter(d => {
            const yearMatch = d.date.getUTCFullYear() === selectedYear;
            const monthMatch = selectedMonth === 0 || d.date.getUTCMonth() + 1 === selectedMonth;
            return yearMatch && monthMatch;
        });

        const enriched: (BankDeposit & { associatedGuest: string, associatedFlats: string[] })[] = monthlyAll.map(deposit => {
            let associatedGuest = '-';
            let associatedFlats: string[] = [];

            const manualMatchRes = manualMatchMap.get(deposit.id);
            if (manualMatchRes && manualMatchRes.length > 0) {
                associatedGuest = manualMatchRes.map(r => r.guestName).join(' + ') + ' (Manual)';
                associatedFlats = Array.from(new Set(manualMatchRes.map(r => r.flat)));
            } 
            else {
                const matchedReservations = depositMatchMap.get(deposit.id);
                if (matchedReservations && matchedReservations.length > 0) {
                    associatedGuest = matchedReservations.map(r => r.guestName).join(' + ');
                    associatedFlats = Array.from(new Set(matchedReservations.map(r => r.flat)));
                } else {
                    const desc = deposit.description.toUpperCase();
                    for (const res of (reservations || [])) {
                         const parts = res.guestName.split(' ').filter(p => p.length > 2);
                         if (parts.length > 1) {
                             const matchCount = parts.reduce((c, p) => desc.includes(p.toUpperCase()) ? c + 1 : c, 0);
                             if (matchCount >= 2) {
                                 associatedGuest = res.guestName + ' (Provável)';
                                 associatedFlats = [res.flat];
                                 break;
                             }
                         }
                    }
                }
            }
            return { ...deposit, associatedGuest, associatedFlats };
        });

        const isMainBusinessSelected = selectedFlats.includes('201') || selectedFlats.includes('202');

        const filtered = enriched.filter(d => {
            // FIX: Se o depósito estiver associado ao flat "Geral" (como o Saldo Decolar),
            // incluímos ele se o negócio principal (201/202) estiver selecionado.
            if (d.associatedFlats.length > 0) {
                return d.associatedFlats.some(f => 
                    selectedFlats.includes(f) || (f === 'Geral' && isMainBusinessSelected)
                );
            }
            // Se não identificado (ex: Depósito sem match), incluímos na visão geral do negócio principal
            return isMainBusinessSelected;
        });

        const finalFiltered = searchTerm ? filtered.filter(d => 
            d.description.toLowerCase().includes(searchTerm.toLowerCase()) || 
            d.associatedGuest.toLowerCase().includes(searchTerm.toLowerCase())
        ) : filtered;

        const totalRev = finalFiltered.reduce((sum: number, d) => sum + d.amount, 0);

        return { monthlyDeposits: finalFiltered.sort((a, b) => a.date.getTime() - b.date.getTime()), totalRevenue: totalRev };
    }, [deposits, selectedYear, selectedMonth, allMatchedPairs, reservations, selectedFlats, searchTerm, manualConciliations]);

    // 3. Expenses calculation (Sync with Yearly)
    const { totalExpenses, expenseDetails } = useMemo(() => {
        let total = 0;
        const details: Record<string, number> = {};
        const months = selectedMonth === 0 ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [selectedMonth];

        months.forEach(m => {
            const cleaningData = unifiedData[`cleaningConfig-${selectedYear}-${m}`] as CleaningData;
            if (cleaningData?.generalServices) {
                const cost = cleaningData.generalServices
                    .filter(s => selectedFlats.includes(s.flat) || s.flat === 'Geral')
                    .reduce((sum: number, s) => sum + s.value, 0);
                if (cost > 0) details['Manutenção/Extras'] = (details['Manutenção/Extras'] || 0) + cost;
            }

            if (selectedFlats.includes('201') || selectedFlats.includes('202')) {
                const finData = unifiedData[`financialConfig-${selectedYear}-${m}`] as FinancialData;
                if (finData) {
                    const de = finData.deductibleExpenses || {};
                    if (selectedFlats.includes('201')) {
                        details['Condomínio 201'] = (details['Condomínio 201'] || 0) + (de.condominio || 0);
                        const t1 = (de.taxaExtra || 0) + (de.energia || 0) + (de.iptu || 0);
                        if (t1 > 0) details['Taxas 201'] = (details['Taxas 201'] || 0) + t1;
                    }
                    if (selectedFlats.includes('202')) {
                        details['Condomínio 202'] = (details['Condomínio 202'] || 0) + (de.condominio202 || 0);
                        const t2 = (de.taxaExtra202 || 0) + (de.energia202 || 0) + (de.iptu202 || 0);
                        if (t2 > 0) details['Taxas 202'] = (details['Taxas 202'] || 0) + t2;
                    }
                    details['Mensalidade Stays'] = (details['Mensalidade Stays'] || 0) + (finData.otherExpenses?.mensalidadeStays || 0);
                    (finData.customExpenses || []).forEach(e => {
                        details[e.description || 'Outros'] = (details[e.description || 'Outros'] || 0) + e.value;
                    });
                } else {
                    if (selectedFlats.includes('201')) details['Condomínio 201'] = (details['Condomínio 201'] || 0) + CONDOMINIO_201_FIXED;
                    if (selectedFlats.includes('202')) details['Condomínio 202'] = (details['Condomínio 202'] || 0) + CONDOMINIO_202_FIXED;
                    details['Mensalidade Stays'] = (details['Mensalidade Stays'] || 0) + 250;
                }
                
                let prevY = selectedYear, prevM = m - 1;
                if (m === 1) { prevY = selectedYear - 1; prevM = 12; }
                const tax = (carneLeaoData[prevY] || []).find(d => d.month === prevM)?.taxDue || 0;
                const impostoLabel = selectedYear >= 2026 ? 'Imposto Simples Nacional' : 'Imposto Carnê Leão';
                if (tax > 0) details[impostoLabel] = (details[impostoLabel] || 0) + tax;
            }

            if (selectedFlats.includes('301')) {
                const finData301 = unifiedData[`financialConfig301-${selectedYear}-${m}`] as FinancialData;
                details['Sistemas (301)'] = (details['Sistemas (301)'] || 0) + 250;
                if (finData301) {
                    const de = finData301.deductibleExpenses || {};
                    const sum = (Object.values(de) as number[]).reduce((a: number, b: number) => a + b, 0);
                    details['Despesas Flat 301'] = (details['Despesas Flat 301'] || 0) + sum;
                }
            }
        });
        
        total = (Object.values(details) as number[]).reduce((acc: number, v: number) => acc + v, 0);
        return { totalExpenses: total, expenseDetails: details };
    }, [selectedFlats, selectedYear, selectedMonth, unifiedData, carneLeaoData]);

    const reportTitle = selectedMonth === 0 ? `RELATÓRIO DE CAIXA ANUAL - ${selectedYear}` : `RELATÓRIO DE CAIXA MENSAL - ${getMonthName(selectedMonth).toUpperCase()}/${selectedYear}`;

    return (
        <div className="space-y-6">
            <div className="card p-6">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-4">
                    <h2 className="text-xl font-bold text-slate-700 dark:text-slate-200">{reportTitle}</h2>
                    <button onClick={() => exportToPdf(reportTitle, ['Data', 'Desc', 'Hosp', 'Valor'], monthlyDeposits.map(d => [formatDate(d.date), d.description, d.associatedGuest, formatCurrency(Number(d.amount))]))} className="bg-red-500 text-white p-2 rounded-md hover:bg-red-600"><svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg></button>
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
                        <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">Receita Bruta (Banco)</h3>
                        <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-2">{formatCurrency(totalRevenue)}</p>
                    </div>
                    <div className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
                        <div className="flex justify-between items-start">
                            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">Despesas Pagas</h3>
                            <button onClick={() => setShowExpenseDetails(!showExpenseDetails)} className="text-blue-500 text-xs hover:underline">{showExpenseDetails ? 'Ocultar' : 'Ver'}</button>
                        </div>
                        <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-2">{formatCurrency(totalExpenses)}</p>
                        {showExpenseDetails && (
                            <div className="mt-3 text-sm border-t pt-2 space-y-1">
                                {Object.entries(expenseDetails).map(([key, value]) => (
                                    /* FIX: Ensure formatCurrency receives a number by casting value from Record entry which might be inferred as unknown */
                                    <div key={key} className="flex justify-between text-slate-600 dark:text-slate-300"><span>{key}</span><span>{formatCurrency(Number(value))}</span></div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
                        <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">Saldo de Caixa</h3>
                        <p className={`text-2xl font-bold mt-2 ${totalRevenue - totalExpenses >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(totalRevenue - totalExpenses)}</p>
                    </div>
                </div>

                <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200 mb-4 border-t pt-4">Lista Detalhada de Depósitos</h3>
                <div className="overflow-x-auto max-h-[500px]">
                    <table className="min-w-full">
                        <thead className="sticky top-0"><tr><th className="text-left">Data</th><th className="text-left">Descrição</th><th className="text-left">Hóspede/Flat</th><th className="text-right">Valor</th></tr></thead>
                        <tbody>
                            {monthlyDeposits.map((d, idx) => (
                                <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700/50"><td>{formatDate(d.date)}</td><td>{d.description}</td><td>{d.associatedGuest}</td><td className="text-right font-mono">{formatCurrency(d.amount)}</td></tr>
                            ))}
                            {monthlyDeposits.length === 0 && (<tr><td colSpan={4} className="text-center py-4 text-slate-500">Nenhum dado encontrado.</td></tr>)}
                        </tbody>
                        <tfoot className="bg-slate-100 dark:bg-slate-800 font-bold sticky bottom-0"><tr><td colSpan={3} className="text-right py-2 px-4 uppercase">Total Receitas:</td><td className="text-right py-2 px-4">{formatCurrency(totalRevenue)}</td></tr></tfoot>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default CashFlowReport;
