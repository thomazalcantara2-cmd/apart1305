
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Reservation, UnifiedData, CleaningData, LaundryEntry, GeneralService } from '../../types';
import { formatDate, formatCurrency, exportToExcel, getMonthName, sanitizePdfText } from '../../utils/helpers';
import { saveConfigData } from '../../services/dataService';
import { GoogleGenAI } from "@google/genai";

// Declare introJs to avoid TypeScript errors since it's loaded from a CDN
declare const introJs: any;

interface Props {
    reservations: Reservation[];
    unifiedData: UnifiedData;
    selectedYear: number;
    selectedMonth: number;
    searchTerm: string;
    onDataSave: (key: string, data: CleaningData) => void;
}

// Internal reusable component for collapsible sections
const CollapsibleCard: React.FC<{ 
    title: React.ReactNode; 
    children: React.ReactNode; 
    defaultOpen?: boolean; 
    className?: string;
    headerClassName?: string;
    tourId?: string;
    rightElement?: React.ReactNode;
}> = ({ title, children, defaultOpen = false, className = "", headerClassName = "", tourId, rightElement }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className={`card overflow-hidden transition-all duration-300 ${className}`} data-tour-laundry={tourId}>
            <div 
                className={`p-6 flex justify-between items-center cursor-pointer bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors ${headerClassName} ${isOpen ? 'border-b border-slate-100 dark:border-slate-700' : ''}`} 
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="flex items-center gap-3 text-lg font-bold text-slate-700 dark:text-slate-200">
                    <svg className={`w-5 h-5 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    {title}
                </div>
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {rightElement}
                </div>
            </div>
            {isOpen && (
                <div className="p-6 animate-fade-in">
                    {children}
                </div>
            )}
        </div>
    );
};

const LaundryControlReport: React.FC<Props> = ({ reservations, unifiedData, selectedYear, selectedMonth, searchTerm, onDataSave }) => {
    const [isSaving, setIsSaving] = useState(false);
    const [showBaseValues, setShowBaseValues] = useState(false);
    const [showDetails, setShowDetails] = useState(false);
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [startTour, setStartTour] = useState(false);
    const [localNewAdvance, setLocalNewAdvance] = useState<string | null>(null);
    const [localServiceDeduction, setLocalServiceDeduction] = useState<string | null>(null);
    const [showRules, setShowRules] = useState(false);
    
    // State to track if the user has manually overridden the automatic service deduction
    const [userHasEditedDeduction, setUserHasEditedDeduction] = useState(false);

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
                        element: '[data-tour-laundry="title"]',
                        title: 'Controle Financeiro de Lavanderia 🧺',
                        intro: 'Aqui você gerencia quanto deve pagar à empresa de limpeza. O relatório calcula o custo exato por estadia (faxina + peças de roupa).',
                        position: 'bottom'
                    },
                    {
                        element: '[data-tour-laundry="rules-toggle"]',
                        title: 'Regras do Jogo ℹ️',
                        intro: 'Clique aqui para relembrar quanto custa a faxina base de cada flat e quantas peças de roupa estão incluídas no pacote padrão.',
                        position: 'bottom'
                    },
                    {
                        element: '[data-tour-laundry="table-section"]',
                        title: '1. Apuração dos Serviços (Tabela) 📝',
                        intro: 'Abra esta seção para conferir cada reserva. Se uma camareira usou mais roupa que o padrão ou fez uma faxina extra, você deve lançar aqui para que o sistema cobre corretamente.',
                        position: 'top'
                    },
                    {
                        element: '[data-tour-laundry="general-services"]',
                        title: '2. Serviços Avulsos 🛠️',
                        intro: 'Contratou uma limpeza de ar-condicionado ou uma faxina pesada sem hóspede? Lance esses valores avulsos aqui.',
                        position: 'top'
                    },
                    {
                        element: '[data-tour-laundry="advances-section"]',
                        title: '3. Fluxo de Caixa (Adiantamentos) 💸',
                        intro: 'Esta é sua "carteira" com a prestadora. Registre aqui os adiantamentos que você fez durante o mês. O sistema vai abater o valor dos serviços realizados desse saldo.',
                        position: 'top'
                    },
                    {
                        element: '[data-tour-laundry="final-breakdown"]',
                        title: '4. Quanto Pagar? (Resumo) ✅',
                        intro: 'Este quadro final te diz exatamente quanto você ainda precisa pagar em dinheiro no fim do mês, já descontando os adiantamentos e somando todos os extras.',
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

    const configKey = `cleaningConfig-${selectedYear}-${selectedMonth}`;
    const prevMonth = new Date(selectedYear, selectedMonth - 2, 1);
    const prevConfigKey = `cleaningConfig-${prevMonth.getFullYear()}-${prevMonth.getMonth() + 1}`;
    
    const initialDebt = useMemo(() => {
        const prevMonthData = unifiedData[prevConfigKey] as CleaningData;
        return prevMonthData?.finalDebt || 0;
    }, [unifiedData, prevConfigKey]);

    const filteredReservations = useMemo(() => {
        let reservationsInPeriod = reservations
            .filter(r => r.checkOut.getUTCFullYear() === selectedYear && r.checkOut.getUTCMonth() + 1 === selectedMonth)
            .sort((a, b) => a.checkOut.getTime() - b.checkOut.getTime());

        if (searchTerm) {
            const lowercasedFilter = searchTerm.toLowerCase();
            reservationsInPeriod = reservationsInPeriod.filter(r =>
                r.guestName.toLowerCase().includes(lowercasedFilter) ||
                r.flat.toLowerCase().includes(lowercasedFilter)
            );
        }
        
        return reservationsInPeriod;
    }, [reservations, selectedYear, selectedMonth, searchTerm]);

    const getInitialState = useCallback((): CleaningData => {
        const savedData = unifiedData[configKey] as CleaningData;
        
        const defaultEntries: Record<string, LaundryEntry> = {};
        filteredReservations.forEach(r => {
            const defaultPieces = r.flat === '202' ? 15 : 25;
            defaultEntries[r.id] = {
                laundryQty: defaultPieces,
                hasExtraCleaning: false,
                extraCleaningQty: 1,
                hasExtraLaundry: false,
                extraLaundryQty: defaultPieces,
            };
        });

        const laundryEntries = savedData?.laundryEntries ? 
            { ...defaultEntries, ...savedData.laundryEntries } : 
            defaultEntries;

        return {
            laundryEntries,
            generalServices: savedData?.generalServices || [],
            newAdvance: savedData?.newAdvance || 0,
            serviceDeduction: savedData?.serviceDeduction || 0,
            finalDebt: savedData?.finalDebt || 0,
        };
    }, [unifiedData, configKey, filteredReservations]);

    const [cleaningData, setCleaningData] = useState<CleaningData>(getInitialState);

     const calculateRowTotal = useCallback((res: Reservation): number => {
        const entry = cleaningData.laundryEntries[res.id];
        if (!entry) return 0;
        const baseCleaningCost = res.flat === '202' ? 80 : 100;
        const laundryCost = (entry.laundryQty || 0) * 3;
        const extraLaundryCost = entry.hasExtraLaundry ? (entry.extraLaundryQty || 0) * 3 : 0;
        const extraCleaningCost = entry.hasExtraCleaning ? (entry.extraCleaningQty || 0) * baseCleaningCost : 0;
        
        // Legacy support: include otherServices if they exist in data but don't show in UI
        const legacyServicesCost = (entry.otherServices || []).reduce((sum, service) => {
            return sum + (service.quantity * service.unitValue);
        }, 0);

        return baseCleaningCost + laundryCost + extraLaundryCost + extraCleaningCost + legacyServicesCost;
    }, [cleaningData.laundryEntries]);

    const { totalMonthCost, amountToPayInCash, finalDebt } = useMemo(() => {
        const reservationsTotal = filteredReservations.reduce((total, res) => {
            return total + calculateRowTotal(res);
        }, 0);
        
        const generalServicesTotal = (cleaningData.generalServices || []).reduce((sum, s) => sum + s.value, 0);
        
        const totalCost = reservationsTotal + generalServicesTotal;
        
        // User Formula 1: Valor a Pagar em Dinheiro = (Total de Custos do Mês) - (Amortização)
        const payInCash = Math.max(0, totalCost - (cleaningData.serviceDeduction || 0));

        // User Formula 2: Dívida da Empresa (Final do Mês) = (Dívida Inicial + Novo Adiantamento) - (Amortização)
        // Restriction: Debt cannot be negative.
        const calculatedDebt = (initialDebt || 0) + (cleaningData.newAdvance || 0) - (cleaningData.serviceDeduction || 0);
        const final = Math.max(0, calculatedDebt);

        return { totalMonthCost: totalCost, amountToPayInCash: payInCash, finalDebt: final };
    }, [filteredReservations, cleaningData, initialDebt, calculateRowTotal]);
    
    // Auto-update Service Deduction Logic Removed as per user request

    // Calculate Breakdown for Final Summary
    const breakdown = useMemo(() => {
        // 1. TOTAL FAXINA: Sum of all reservation costs (Base + Laundry + Extras)
        // This MUST match the total of the table column.
        const totalReservationCosts = filteredReservations.reduce((sum, res) => {
            return sum + calculateRowTotal(res);
        }, 0);

        // 2. TOTAL TAXA EXTRA: Sum of independent General Services
        // This matches the "Serviços Extras / Manutenção (Avulsos)" section.
        const totalGeneralServices = (cleaningData.generalServices || []).reduce((sum, s) => sum + s.value, 0);

        return {
            totalFaxina: totalReservationCosts,
            totalExtraFees: totalGeneralServices
        };
    }, [filteredReservations, cleaningData, calculateRowTotal]);


    // Calculate Table Totals
    const tableTotals = useMemo(() => {
        return filteredReservations.reduce((acc, res) => {
            const entry = cleaningData.laundryEntries[res.id];
            const rowTotal = calculateRowTotal(res);
            
            return {
                laundryQty: acc.laundryQty + (entry?.laundryQty || 0),
                extraLaundryCount: acc.extraLaundryCount + (entry?.hasExtraLaundry ? 1 : 0),
                extraLaundryQty: acc.extraLaundryQty + (entry?.hasExtraLaundry ? (entry.extraLaundryQty || 0) : 0),
                extraCleaningCount: acc.extraCleaningCount + (entry?.hasExtraCleaning ? 1 : 0),
                extraCleaningQty: acc.extraCleaningQty + (entry?.hasExtraCleaning ? (entry.extraCleaningQty || 0) : 0),
                cost: acc.cost + rowTotal
            };
        }, { laundryQty: 0, extraLaundryCount: 0, extraLaundryQty: 0, extraCleaningCount: 0, extraCleaningQty: 0, cost: 0 });
    }, [filteredReservations, cleaningData, calculateRowTotal]);

    // Calculate Advance History
    const advanceHistory = useMemo(() => {
        return Object.keys(unifiedData)
            .filter(key => key.startsWith('cleaningConfig-'))
            .map(key => {
                const parts = key.split('-');
                const year = parseInt(parts[1]);
                const month = parseInt(parts[2]);
                const data = unifiedData[key] as CleaningData;
                return {
                    year,
                    month,
                    dateObj: new Date(year, month - 1),
                    newAdvance: data.newAdvance || 0,
                    serviceDeduction: data.serviceDeduction || 0,
                    finalDebt: Math.max(0, data.finalDebt || 0) // Ensure historical debt is not negative
                };
            })
            .sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());
    }, [unifiedData]);

    useEffect(() => {
        setCleaningData(getInitialState());
        // Reset manual edit tracking when changing months
        const saved = unifiedData[configKey] as CleaningData;
        setUserHasEditedDeduction(!!saved);
    }, [getInitialState, configKey, unifiedData]);

    const handleToggleExpand = (id: string) => {
        setExpandedRows(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    };

    const handleEntryChange = (id: string, field: keyof LaundryEntry, value: number | boolean) => {
        setCleaningData(prev => ({
            ...prev,
            laundryEntries: {
                ...prev.laundryEntries,
                [id]: { ...prev.laundryEntries[id], [field]: value }
            }
        }));
    };

    // General Services Handlers
    const handleAddGeneralService = () => {
        setCleaningData(prev => ({
            ...prev,
            generalServices: [
                ...(prev.generalServices || []),
                { id: Date.now().toString(), description: '', flat: 'Geral', value: 0 }
            ]
        }));
    };

    const handleUpdateGeneralService = (id: string, field: keyof GeneralService, value: any) => {
        setCleaningData(prev => ({
            ...prev,
            generalServices: (prev.generalServices || []).map(s => 
                s.id === id ? { ...s, [field]: value } : s
            )
        }));
    };

    const handleRemoveGeneralService = (id: string) => {
        setCleaningData(prev => ({
            ...prev,
            generalServices: (prev.generalServices || []).filter(s => s.id !== id)
        }));
    };

    const handleAdvanceChange = (field: 'newAdvance' | 'serviceDeduction', value: number) => {
        setCleaningData(prev => ({
            ...prev,
            [field]: value
        }));
        if (field === 'serviceDeduction') {
            setUserHasEditedDeduction(true);
        }
    };

    const handleResetDeduction = () => {
        setCleaningData(prev => ({ ...prev, serviceDeduction: totalMonthCost }));
        setUserHasEditedDeduction(false);
    };

    const handleSave = async () => {
        setIsSaving(true);
        const dataToSave: CleaningData = { ...cleaningData, finalDebt };
        try {
            await saveConfigData('cleaningConfig', configKey, dataToSave);
            onDataSave(configKey, dataToSave);
            alert('Dados da lavanderia salvos com sucesso!');
        } catch (error) {
            console.error("Failed to save cleaning data:", error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            alert(`Erro ao salvar os dados. Tente novamente.\n\nDetalhes: ${errorMessage}`);
        } finally {
            setIsSaving(false);
        }
    };

    const handleAnalyzeAdvancesWithAI = async (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent toggling the card
        setIsAssistantOpen(true);
        setIsAssistantLoading(true);
        setAssistantError(null);
        setAssistantExplanation('');

        const prompt = `
            Você é um assistente financeiro especialista em gestão de propriedades e prestação de contas.
            Explique de forma clara e didática a **Gestão de Adiantamentos** do mês de ${getMonthName(selectedMonth)}/${selectedYear} para a empresa de limpeza/lavanderia.

            **Dados do Mês:**
            - Dívida Inicial (Vinda do mês passado): ${formatCurrency(initialDebt)}
            - Novo Adiantamento (Pago à empresa este mês): ${formatCurrency(cleaningData.newAdvance || 0)}
            - Total de Custos de Serviços (O que a empresa "trabalhou"): ${formatCurrency(totalMonthCost)}
            - Amortização da Dívida (Quanto do serviço foi usado para abater a dívida): ${formatCurrency(cleaningData.serviceDeduction || 0)}
            - Valor Pago em Dinheiro (Saldo restante pago no ato): ${formatCurrency(amountToPayInCash)}
            - Dívida Final (Que fica para o próximo mês): ${formatCurrency(finalDebt)}

            **Lógica de Negócio (IMPORTANTE):**
            *   **Amortização:** O valor "Amortização da Dívida" é a parte do dinheiro que a prestadora *ganhou* trabalhando (Custo de Serviços), mas que *não recebeu em dinheiro* agora porque foi usada para abater a dívida antiga.
            *   **Por que não é automático?** Não descontamos a dívida inteira automaticamente porque, muitas vezes, para não "onerar" a prestadora e deixá-la sem dinheiro no mês, decidimos amortizar apenas uma parte da dívida, pagando o restante do serviço em dinheiro.

            **Estrutura da Explicação:**
            1. **O que a empresa "ganhou" trabalhando:** (Total de Custos de Serviços).
            2. **O fluxo da Dívida:** (Dívida Inicial + Novo Adiantamento).
            3. **A Decisão de Pagamento:** Explique quanto foi pago em dinheiro vivo e quanto foi usado para amortizar a dívida. Mencione que a amortização foi uma escolha para equilibrar a quitação da dívida sem zerar o caixa da prestadora.
            4. **Conclusão:** O saldo final da dívida.

            Use negrito nos valores e mantenha um tom profissional e direto.
        `;

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });

            setAssistantExplanation(response.text || 'Não foi possível gerar a explicação.');
        } catch (e: any) {
            console.error("Gemini API call failed:", e);
            setAssistantError(`A análise de IA falhou. Por favor, verifique sua conexão ou chave de API. Detalhe: ${e.message}`);
        } finally {
            setIsAssistantLoading(false);
        }
    };
    
    const handleExportPdf = () => {
        const doc = new (window as any).jspdf.jsPDF();
        const title = `Controle de Lavanderia - ${getMonthName(selectedMonth)}/${selectedYear}`;
        doc.text(title, 14, 16);

        // 1. Reservations Table
        const headers = [["Hóspede / Período", "Qtd. Lavanderia", "Extra Lav?", "Extra Fax?", "TOTAL"]];
        const data = filteredReservations.map(res => {
            const entry = cleaningData.laundryEntries[res.id];
            return [
                `${sanitizePdfText(res.guestName)} (${res.flat})\n${formatDate(res.checkIn)} a ${formatDate(res.checkOut)}`,
                entry?.laundryQty || 0,
                entry?.hasExtraLaundry ? `Sim (${entry.extraLaundryQty || 0})` : 'Não',
                entry?.hasExtraCleaning ? `Sim (${entry.extraCleaningQty || 0})` : 'Não',
                formatCurrency(calculateRowTotal(res))
            ];
        });
        
        doc.autoTable({
            startY: 22,
            head: headers,
            body: data,
            foot: [[
                'TOTAL',
                tableTotals.laundryQty,
                `Extra: ${tableTotals.extraLaundryQty}`,
                `Extra: ${tableTotals.extraCleaningQty}`,
                formatCurrency(tableTotals.cost)
            ]],
            theme: 'grid',
            styles: { fontSize: 8, valign: 'middle' },
            footStyles: { fillColor: [44, 62, 80], textColor: [255, 255, 255], fontStyle: 'bold' }
        });
    
        let finalY = (doc as any).autoTable.previous.finalY;

        // 2. General Services Table (if any)
        if (cleaningData.generalServices && cleaningData.generalServices.length > 0) {
            doc.text("Serviços Extras / Manutenção", 14, finalY + 10);
            const serviceHeaders = [["Descrição", "Flat", "Valor"]];
            const serviceData = cleaningData.generalServices.map(s => [
                sanitizePdfText(s.description),
                s.flat,
                formatCurrency(s.value)
            ]);

            doc.autoTable({
                startY: finalY + 15,
                head: serviceHeaders,
                body: serviceData,
                theme: 'grid',
                styles: { fontSize: 8, valign: 'middle' },
                headStyles: { fillColor: [245, 158, 11] } // Amber color
            });
            finalY = (doc as any).autoTable.previous.finalY;
        }
    
        // 3. Totals Breakdown
        doc.autoTable({
            startY: finalY + 10,
            body: [
                ['1) TOTAL FAXINA', formatCurrency(breakdown.totalFaxina)],
                ['2) Serviços Extras / Manutenção (Avulsos)', formatCurrency(breakdown.totalExtraFees)],
                ['3) SUB-TOTAL', formatCurrency(totalMonthCost)],
                ['4) Valor pago do empréstimo (Amortização)', formatCurrency(cleaningData.serviceDeduction)],
                ['5) A pagar (Dinheiro)', formatCurrency(amountToPayInCash)],
            ],
            theme: 'striped',
            styles: { fontSize: 10, fontStyle: 'bold' }
        });
    
        doc.save(`Controle_Lavanderia_${selectedYear}_${selectedMonth}.pdf`);
    };

    const handleExportExcel = () => {
        const excelData = filteredReservations.map(res => {
            const entry = cleaningData.laundryEntries[res.id];
            
            return {
                'Tipo': 'Reserva',
                'Descrição': `${res.guestName} (${res.flat})`,
                'Período': `${formatDate(res.checkIn)} a ${formatDate(res.checkOut)}`,
                'Qtd. Lavanderia': entry?.laundryQty || 0,
                'Extra Lavanderia?': entry?.hasExtraLaundry ? 'Sim' : 'Não',
                'Qtd. Extra Lav.': entry?.hasExtraLaundry ? entry.extraLaundryQty : 0,
                'Extra Faxina?': entry?.hasExtraCleaning ? 'Sim' : 'Não',
                'Qtd. Extra Fax.': entry?.hasExtraCleaning ? entry.extraCleaningQty : 0,
                'Valor (R$)': calculateRowTotal(res)
            };
        });

        // Add General Services
        if (cleaningData.generalServices) {
            cleaningData.generalServices.forEach(s => {
                excelData.push({
                    'Tipo': 'Serviço Extra',
                    'Descrição': s.description,
                    'Período': s.flat,
                    'Qtd. Lavanderia': 0,
                    'Extra Lavanderia?': '-',
                    'Qtd. Extra Lav.': 0,
                    'Extra Faxina?': '-',
                    'Qtd. Extra Fax.': 0,
                    'Valor (R$)': s.value
                });
            });
        }
        
        excelData.push({} as any); // spacer row
        excelData.push({ 'Tipo': 'RESUMO DETALHADO' } as any);
        excelData.push({ 'Tipo': '1) TOTAL FAXINA', 'Descrição': breakdown.totalFaxina } as any);
        excelData.push({ 'Tipo': '2) Serviços Extras / Manutenção (Avulsos)', 'Descrição': breakdown.totalExtraFees } as any);
        excelData.push({ 'Tipo': '3) SUB-TOTAL', 'Descrição': totalMonthCost } as any);
        excelData.push({ 'Tipo': '4) Valor pago do empréstimo (Amortização)', 'Descrição': cleaningData.serviceDeduction } as any);
        excelData.push({ 'Tipo': '5) A pagar (Dinheiro)', 'Descrição': amountToPayInCash } as any);
    
        exportToExcel(`Controle_Lavanderia_${selectedYear}_${selectedMonth}`, excelData);
    };

    const totalColumns = 5 + (showBaseValues ? 1 : 0) + (showDetails ? 1 : 0);

    const isEditingNewAdvance = localNewAdvance !== null;
    const isEditingServiceDeduction = localServiceDeduction !== null;


    return (
        <div className="space-y-6">
            <div className="card p-6">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-4">
                     <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-slate-700 dark:text-slate-200" title="Gerencia os custos de limpeza e lavanderia por estadia e controla o saldo de adiantamentos da prestadora de serviço." data-tour-laundry="title">CONTROLE DE LAVANDERIA</h2>
                         <button onClick={() => setStartTour(true)} title="Ajuda sobre este relatório" className="bg-blue-100 text-blue-700 p-2 rounded-full hover:bg-blue-200 transition-colors dark:bg-slate-700 dark:text-blue-300 dark:hover:bg-slate-600">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.546-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </button>
                        <button onClick={() => setShowRules(!showRules)} title="Ver Regras de Cobrança" className={`p-2 rounded-full hover:bg-yellow-200 transition-colors dark:hover:bg-yellow-800 ${showRules ? 'bg-yellow-200 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-200' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300'}`} data-tour-laundry="rules-toggle">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button onClick={() => setShowDetails(!showDetails)} className="bg-slate-200 text-slate-700 px-4 py-2 rounded-md hover:bg-slate-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500">
                           {showDetails ? 'Ocultar Detalhes' : 'Ver Detalhes'}
                        </button>
                        <button onClick={() => setShowBaseValues(!showBaseValues)} className="bg-slate-200 text-slate-700 px-4 py-2 rounded-md hover:bg-slate-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500">
                           {showBaseValues ? 'Ocultar Valores' : 'Editar Valores'}
                        </button>
                        <button
                            onClick={handleExportPdf}
                            title="Exportar para PDF"
                            className="bg-red-500 text-white p-2 rounded-md hover:bg-red-600 transition-colors"
                        >
                           <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        </button>
                        <button
                            onClick={handleExportExcel}
                            title="Exportar para Excel"
                            className="bg-green-500 text-white p-2 rounded-md hover:bg-green-600 transition-colors"
                        >
                           <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        </button>
                        <button onClick={handleSave} disabled={isSaving} className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:bg-blue-300" data-tour-laundry="save-button">
                            {isSaving ? 'Salvando...' : 'Salvar Alterações'}
                        </button>
                    </div>
                </div>

                {/* Pricing Rules Info Box (Hidden by default, toggled via header icon) */}
                {showRules && (
                    <div className="bg-yellow-50 dark:bg-yellow-900/10 p-3 rounded-md mb-6 border border-yellow-200 dark:border-yellow-800 text-sm animate-fade-in" data-tour-laundry="rules">
                        <p className="font-bold text-yellow-800 dark:text-yellow-200 flex items-center gap-2 mb-2">
                            Regras de Cobrança por Flat:
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-2 text-yellow-900 dark:text-yellow-100">
                            <div className="flex items-center gap-2">
                                <span className="font-bold bg-white dark:bg-slate-800 px-2 py-0.5 rounded border border-yellow-300 dark:border-yellow-700">Flat 202</span>
                                <span>Faxina: <strong>R$ 80,00</strong> | Franquia Lavanderia: <strong>15 peças</strong></span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="font-bold bg-white dark:bg-slate-800 px-2 py-0.5 rounded border border-yellow-300 dark:border-yellow-700">Flats 201 & 301</span>
                                <span>Faxina: <strong>R$ 100,00</strong> | Franquia Lavanderia: <strong>25 peças</strong></span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Collapsible Table Section */}
            <CollapsibleCard title="Tabela Editável de Reservas" defaultOpen={false} tourId="table-section">
                <div className="overflow-x-auto">
                    <table className="min-w-full">
                        <thead>
                            <tr>
                                {showDetails && <th className="py-2 px-2 w-12"></th>}
                                <th>Hóspede / Período</th>
                                {showBaseValues && <th className="text-center">Valor Base</th>}
                                <th className="text-center">Qtd. Lavanderia</th>
                                <th className="text-center">Extra Lav?</th>
                                <th className="text-center">Extra Fax?</th>
                                <th className="text-right">TOTAL</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredReservations.map(res => {
                                const entry = cleaningData.laundryEntries[res.id];
                                const isExpanded = expandedRows.has(res.id);
                                
                                const baseCleaningCost = res.flat === '202' ? 80 : 100;
                                const laundryCost = (entry?.laundryQty || 0) * 3;
                                const extraLaundryCost = entry?.hasExtraLaundry ? (entry?.extraLaundryQty || 0) * 3 : 0;
                                const extraCleaningCost = entry.hasExtraCleaning ? (entry.extraCleaningQty || 0) * baseCleaningCost : 0;
                                const legacyCost = (entry?.otherServices || []).reduce((sum, s) => sum + (s.quantity * s.unitValue), 0);

                                return (
                                <React.Fragment key={res.id}>
                                    <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                        {showDetails && (
                                            <td className="py-2 px-2 text-center align-top pt-3">
                                                <button onClick={() => handleToggleExpand(res.id)} className="text-blue-500 hover:text-blue-700 font-mono text-lg" title="Ver detalhes">
                                                    {isExpanded ? '−' : '+'}
                                                </button>
                                            </td>
                                        )}
                                        <td>
                                            <div className="font-medium text-slate-800 dark:text-slate-100">
                                                {res.guestName} <span className="text-xs text-slate-500 font-normal">({res.flat})</span>
                                            </div>
                                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium bg-slate-100 dark:bg-slate-700/50 px-2 py-0.5 rounded w-fit">
                                                {formatDate(res.checkIn)} até {formatDate(res.checkOut)}
                                            </div>
                                        </td>
                                        {showBaseValues && <td className="text-center">{formatCurrency(baseCleaningCost)}</td>}
                                        <td>
                                            <input type="number" value={entry?.laundryQty || ''} onChange={e => handleEntryChange(res.id, 'laundryQty', parseInt(e.target.value, 10))} className="w-20 text-center border rounded p-1 bg-white dark:bg-slate-700" />
                                        </td>
                                        <td className="text-center">
                                            <div className="flex items-center justify-center space-x-2">
                                                <input type="checkbox" checked={entry?.hasExtraLaundry || false} onChange={e => handleEntryChange(res.id, 'hasExtraLaundry', e.target.checked)} className="h-5 w-5" />
                                                {entry?.hasExtraLaundry && <input type="number" value={entry?.extraLaundryQty || ''} onChange={e => handleEntryChange(res.id, 'extraLaundryQty', parseInt(e.target.value, 10))} className="w-16 text-center border rounded p-1 bg-white dark:bg-slate-700" />}
                                            </div>
                                        </td>
                                        <td className="text-center">
                                            <div className="flex items-center justify-center space-x-2">
                                                <input type="checkbox" checked={entry?.hasExtraCleaning || false} onChange={e => handleEntryChange(res.id, 'hasExtraCleaning', e.target.checked)} className="h-5 w-5" />
                                                {entry?.hasExtraCleaning && <input type="number" value={entry?.extraCleaningQty || ''} onChange={e => handleEntryChange(res.id, 'extraCleaningQty', parseInt(e.target.value, 10))} className="w-16 text-center border rounded p-1 bg-white dark:bg-slate-700" />}
                                            </div>
                                        </td>
                                        <td className="text-right font-semibold">{formatCurrency(calculateRowTotal(res))}</td>
                                    </tr>
                                     {isExpanded && showDetails && (
                                        <tr>
                                            <td colSpan={totalColumns} className="p-0">
                                               <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded m-2 border border-blue-200 dark:border-blue-900">
                                                    <h4 className="font-bold mb-2 text-slate-700 dark:text-slate-200">Detalhes do Custo para {res.guestName}</h4>
                                                    <div className="grid grid-cols-1 gap-6">
                                                        <ul className="list-disc list-inside text-sm space-y-1 text-slate-600 dark:text-slate-300">
                                                            <li>Custo Base Faxina ({formatCurrency(baseCleaningCost)}): {formatCurrency(baseCleaningCost)}</li>
                                                            <li>Custo Lavanderia: {formatCurrency(laundryCost)} ({entry?.laundryQty || 0} peças x {formatCurrency(3)})</li>
                                                            {entry?.hasExtraLaundry && (
                                                                <li>Custo Lavanderia Extra: {formatCurrency(extraLaundryCost)} ({entry.extraLaundryQty} peças x {formatCurrency(3)})</li>
                                                            )}
                                                            {entry?.hasExtraCleaning && (
                                                                <li>Custo Faxina Extra: {formatCurrency(extraCleaningCost)} ({entry.extraCleaningQty}x {formatCurrency(baseCleaningCost)})</li>
                                                            )}
                                                            {legacyCost > 0 && <li>Outros (Antigo): {formatCurrency(legacyCost)}</li>}
                                                        </ul>
                                                    </div>
                                               </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            )})}
                             {filteredReservations.length === 0 && (
                                <tr>
                                    <td colSpan={totalColumns} className="py-4 px-4 text-center text-slate-500">Nenhuma reserva encontrada para os filtros selecionados.</td>
                                </tr>
                            )}
                        </tbody>
                        <tfoot className="bg-slate-100 dark:bg-slate-800 border-t-2 border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200">
                            <tr>
                                {showDetails && <td></td>}
                                <td className="py-3 px-4 text-right">TOTAL</td>
                                {showBaseValues && <td></td>}
                                <td className="text-center">{tableTotals.laundryQty}</td>
                                <td className="text-center text-xs">
                                    {tableTotals.extraLaundryCount > 0 && <div>{tableTotals.extraLaundryCount} res.</div>}
                                    {tableTotals.extraLaundryQty > 0 && <div className="text-slate-500">({tableTotals.extraLaundryQty} pçs)</div>}
                                </td>
                                <td className="text-center text-xs">
                                    {tableTotals.extraCleaningCount > 0 && <div>{tableTotals.extraCleaningCount} res.</div>}
                                    {tableTotals.extraCleaningQty > 0 && <div className="text-slate-500">({tableTotals.extraCleaningQty} fax)</div>}
                                </td>
                                <td className="text-right px-4">{formatCurrency(tableTotals.cost)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </CollapsibleCard>

            {/* General Services Section (Collapsible) */}
            <CollapsibleCard 
                title="Serviços Extras / Manutenção (Avulsos)" 
                defaultOpen={false} 
                className="border border-amber-200 dark:border-amber-800"
                headerClassName="bg-amber-50 dark:bg-amber-900/10 hover:bg-amber-100 dark:hover:bg-amber-900/20 text-amber-800 dark:text-amber-100"
                tourId="general-services"
                rightElement={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-500" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg>}
            >
                <div className="space-y-2">
                    {cleaningData.generalServices && cleaningData.generalServices.map((service) => (
                        <div key={service.id} className="flex flex-col sm:flex-row gap-2 items-center bg-amber-50 dark:bg-amber-900/10 p-2 rounded">
                            <input 
                                type="text" 
                                placeholder="Descrição (ex: Faxina Pesada)"
                                value={service.description}
                                onChange={(e) => handleUpdateGeneralService(service.id, 'description', e.target.value)}
                                className="border rounded p-2 flex-grow w-full sm:w-auto text-sm dark:bg-slate-700 dark:border-slate-600"
                            />
                            <select
                                value={service.flat}
                                onChange={(e) => handleUpdateGeneralService(service.id, 'flat', e.target.value)}
                                className="border rounded p-2 w-full sm:w-28 text-sm dark:bg-slate-700 dark:border-slate-600"
                            >
                                <option value="Geral">Geral</option>
                                <option value="201">201</option>
                                <option value="202">202</option>
                                <option value="301">301</option>
                            </select>
                            <input 
                                type="number" 
                                placeholder="Valor"
                                value={service.value}
                                onChange={(e) => handleUpdateGeneralService(service.id, 'value', parseFloat(e.target.value) || 0)}
                                className="border rounded p-2 w-full sm:w-32 text-right text-sm dark:bg-slate-700 dark:border-slate-600"
                            />
                            <button onClick={() => handleRemoveGeneralService(service.id)} className="text-red-500 hover:text-red-700 p-2" title="Remover">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                            </button>
                        </div>
                    ))}
                    {(!cleaningData.generalServices || cleaningData.generalServices.length === 0) && (
                        <p className="text-sm text-slate-500 italic text-center py-2">Nenhum serviço extra adicionado.</p>
                    )}
                    <button onClick={handleAddGeneralService} className="mt-2 w-full sm:w-auto text-sm bg-amber-100 text-amber-800 px-4 py-2 rounded hover:bg-amber-200 transition-colors font-medium border border-amber-300">
                        + Adicionar Serviço Extra
                    </button>
                </div>
            </CollapsibleCard>

            <CollapsibleCard 
                title="Gestão de Adiantamentos" 
                defaultOpen={false} 
                tourId="advances-section"
                rightElement={
                    <button onClick={handleAnalyzeAdvancesWithAI} className="bg-purple-100 text-purple-700 p-2 rounded-full hover:bg-purple-200 transition-colors dark:bg-slate-700 dark:text-purple-300 dark:hover:bg-slate-600" title="Explicar com IA">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                        </svg>
                    </button>
                }
            >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-slate-500" title="Valor herdado automaticamente da 'Dívida Final' do mês anterior.">Dívida da Empresa (Início do Mês)</label>
                        <input type="text" readOnly value={formatCurrency(initialDebt)} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border rounded p-2" />
                    </div>
                     <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Novo Adiantamento (Pago no mês)</label>
                        <div className="relative mt-1 rounded-md shadow-sm">
                            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                <span className="text-slate-500 sm:text-sm">R$</span>
                            </div>
                            <input
                                type="text"
                                inputMode="decimal"
                                value={isEditingNewAdvance ? (localNewAdvance || '') : formatCurrency(cleaningData.newAdvance)}
                                onFocus={() => setLocalNewAdvance(cleaningData.newAdvance ? String(cleaningData.newAdvance).replace('.', ',') : '')}
                                onChange={e => { setLocalNewAdvance(e.target.value); }}
                                onBlur={() => {
                                    if (localNewAdvance !== null) {
                                        const sanitized = localNewAdvance.replace(/[^\d,]/g, '');
                                        const numericValue = parseFloat(sanitized.replace(',', '.')) || 0;
                                        handleAdvanceChange('newAdvance', numericValue);
                                    }
                                    setLocalNewAdvance(null);
                                }}
                                className="block w-full rounded-md border-slate-300 dark:border-slate-600 pl-10 pr-4 py-2 focus:border-blue-500 focus:ring-blue-500 sm:text-sm bg-white dark:bg-slate-700 text-right"
                                placeholder="0,00"
                            />
                        </div>
                    </div>
                     <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Amortização da Dívida (com Serviços)</label>
                        <p className="text-xs text-slate-500">TOTAL DE CUSTOS DO MÊS: <span className="font-semibold">{formatCurrency(totalMonthCost)}</span></p>
                        <div className="flex items-center mt-1">
                            <div className="relative flex-grow">
                                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                    <span className="text-slate-500 sm:text-sm">R$</span>
                                </div>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={isEditingServiceDeduction ? (localServiceDeduction || '') : formatCurrency(cleaningData.serviceDeduction)}
                                    onFocus={() => setLocalServiceDeduction(cleaningData.serviceDeduction ? String(cleaningData.serviceDeduction).replace('.', ',') : '')}
                                    onChange={e => { 
                                        setLocalServiceDeduction(e.target.value); 
                                        setUserHasEditedDeduction(true); // User is manually editing, disable auto-sync
                                    }}
                                    onBlur={() => {
                                        if (localServiceDeduction !== null) {
                                            const sanitized = localServiceDeduction.replace(/[^\d,]/g, '');
                                            const numericValue = parseFloat(sanitized.replace(',', '.')) || 0;
                                            handleAdvanceChange('serviceDeduction', numericValue);
                                        }
                                        setLocalServiceDeduction(null);
                                    }}
                                    className="block w-full rounded-none rounded-l-md border border-slate-300 dark:border-slate-600 pl-10 pr-4 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm bg-white dark:bg-slate-700 text-right"
                                    placeholder="0,00"
                                />
                            </div>
                            <button 
                                onClick={handleResetDeduction}
                                className="px-3 py-2 bg-slate-200 border border-l-0 border-slate-300 dark:border-slate-600 rounded-r-md text-sm hover:bg-slate-300 dark:bg-slate-600 dark:hover:bg-slate-500" 
                                title="Usar valor total do mês (Auto)"
                            >
                                Auto
                            </button>
                        </div>
                    </div>
                    
                     <div className="md:col-span-3 mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg space-y-3" data-tour-laundry="summary-section">
                        <div className="flex flex-col md:flex-row justify-between items-center border-b border-blue-200 dark:border-blue-800 pb-2">
                            <div className="text-center flex-1 mb-2 md:mb-0">
                                <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">Valor a Pagar em Dinheiro (este mês)</label>
                                <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{formatCurrency(amountToPayInCash)}</p>
                            </div>
                            <div className="text-center flex-1">
                                <label className="block text-lg font-bold text-blue-800 dark:text-blue-300">Dívida da Empresa (Final do Mês)</label>
                                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{formatCurrency(finalDebt)}</p>
                            </div>
                        </div>
                        <div className="text-center">
                             <p className="text-xs text-slate-500 italic" title="Dívida Final = (Dívida Inicial + Novo Adiantamento) - Amortização">
                                Cálculo: ( {formatCurrency(initialDebt)} + {formatCurrency(cleaningData.newAdvance || 0)} ) - {formatCurrency(cleaningData.serviceDeduction || 0)}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="mt-8 border-t pt-4">
                    <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200 mb-2">Histórico de Adiantamentos</h3>
                    <div className="overflow-x-auto max-h-48 border rounded-md">
                        <table className="min-w-full text-sm">
                            <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
                                <tr>
                                    <th className="px-4 py-2 text-left">Mês/Ano</th>
                                    <th className="px-4 py-2 text-right">Novo Adiantamento</th>
                                    <th className="px-4 py-2 text-right">Amortização</th>
                                    <th className="px-4 py-2 text-right">Dívida Final</th>
                                </tr>
                            </thead>
                            <tbody>
                                {advanceHistory.map((item, idx) => (
                                    <tr key={`${item.year}-${item.month}`} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                        <td className="px-4 py-2 font-medium">{getMonthName(item.month)}/{item.year}</td>
                                        <td className="px-4 py-2 text-right">{formatCurrency(item.newAdvance)}</td>
                                        <td className="px-4 py-2 text-right">{formatCurrency(item.serviceDeduction)}</td>
                                        <td className="px-4 py-2 text-right font-bold text-blue-600">{formatCurrency(item.finalDebt)}</td>
                                    </tr>
                                ))}
                                {advanceHistory.length === 0 && (
                                    <tr><td colSpan={4} className="text-center py-4 text-slate-500">Nenhum histórico encontrado.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </CollapsibleCard>

            {/* Detailed Summary Breakdown (Always Open) */}
            <div className="card p-6 bg-slate-50 dark:bg-slate-700/30 border border-slate-200 dark:border-slate-700 mt-6" data-tour-laundry="final-breakdown">
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4 uppercase tracking-wider border-b pb-2 border-slate-300 dark:border-slate-600">
                    RESUMO GERAL DO MÊS
                </h3>
                <div className="space-y-3">
                    <div className="flex justify-between items-center text-slate-700 dark:text-slate-300">
                        <span className="font-medium">1) TOTAL FAXINA:</span>
                        <span>{formatCurrency(breakdown.totalFaxina)}</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-700 dark:text-slate-300">
                        <span className="font-medium">2) Serviços Extras / Manutenção (Avulsos):</span>
                        <span>{formatCurrency(breakdown.totalExtraFees)}</span>
                    </div>
                    <div className="flex justify-between items-center text-lg font-bold text-slate-900 dark:text-slate-100 border-t border-slate-300 dark:border-slate-600 pt-2">
                        <span>3) SUB-TOTAL:</span>
                        <span>{formatCurrency(totalMonthCost)}</span>
                    </div>
                    <div className="flex justify-between items-center text-red-600 dark:text-red-400 font-medium">
                        <span>4) Valor pago do empréstimo (Amortização):</span>
                        <span>- {formatCurrency(cleaningData.serviceDeduction)}</span>
                    </div>
                    <div className="flex justify-between items-center text-xl font-bold bg-green-50 dark:bg-green-900/20 p-2 rounded text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 mt-2">
                        <span>5) A pagar (Dinheiro):</span>
                        <span>{formatCurrency(amountToPayInCash)}</span>
                    </div>
                </div>
            </div>

            {isAssistantOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4" onClick={() => setIsAssistantOpen(false)}>
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-700 pb-3 mb-4">
                            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                                </svg>
                                Assistente IA: Gestão de Adiantamentos
                            </h2>
                            <button onClick={() => setIsAssistantOpen(false)} className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white text-3xl font-light">&times;</button>
                        </div>
                        <div className="overflow-y-auto">
                            {isAssistantLoading && (
                                <div className="flex flex-col items-center justify-center p-8">
                                    <div className="loader ease-linear rounded-full border-4 border-t-4 border-gray-200 h-12 w-12 mb-4 animate-spin" style={{borderTopColor: '#8b5cf6'}}></div>
                                    <p className="mt-4 text-slate-600 dark:text-slate-300">Analisando os dados financeiros...</p>
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

export default LaundryControlReport;
