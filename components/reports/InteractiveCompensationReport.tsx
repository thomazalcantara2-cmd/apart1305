
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Reservation, BankDeposit, MatchedPair, ManualConciliation, DismissedAutoMatch } from '../../types';
import { formatDate, formatCurrency } from '../../utils/helpers';
import { performAutoReconciliation } from '../../utils/reconciliation';

// Declare introJs to avoid TypeScript errors since it's loaded from a CDN
declare const introJs: any;

interface Props {
    reservations: Reservation[];
    deposits: BankDeposit[];
    manualAdjustments: Record<string, number>;
    setManualAdjustments: React.Dispatch<React.SetStateAction<Record<string, number>>>;
    manualConciliations: ManualConciliation[];
    onSaveConciliations: (conciliations: ManualConciliation[]) => void;
    dismissedAutoMatches?: DismissedAutoMatch[];
    onRestoreAutoMatch?: (dismissedId: string) => void;
    /** ID de reserva pré-selecionada (atalho a partir de "Competência × Caixa"). */
    initialSelectedReservationId?: string | null;
    /** Callback para limpar o flag após consumir. */
    onInitialSelectionConsumed?: () => void;
}

interface HydratedManualConciliation extends ManualConciliation {
    reservations: Reservation[];
    deposits: BankDeposit[];
}

const AdjustmentModal: React.FC<{
    reservation: Reservation;
    onClose: () => void;
    onSave: (id: string, discount: number) => void;
    currentDiscount: number;
}> = ({ reservation, onClose, onSave, currentDiscount }) => {
    const [discount, setDiscount] = useState(currentDiscount);

    const handleSave = () => {
        onSave(reservation.id, discount);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md">
                <h3 className="text-lg font-bold mb-4">Ajustar Valor da Estadia</h3>
                <p><strong>Hóspede:</strong> {reservation.guestName}</p>
                <p><strong>Líquido Original:</strong> {formatCurrency(reservation.netEarnings)}</p>
                <div className="my-4">
                    <label htmlFor="discount" className="block text-sm font-medium text-gray-700">Valor do Desconto/Ajuste</label>
                    <input
                        type="number"
                        id="discount"
                        value={discount || ''}
                        onChange={(e) => setDiscount(Number(e.target.value))}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm"
                        placeholder="Ex: 50.25"
                    />
                </div>
                <p><strong>Novo Valor Líquido:</strong> {formatCurrency(reservation.netEarnings - discount)}</p>
                <div className="mt-6 flex justify-end space-x-3">
                    <button onClick={onClose} className="px-4 py-2 bg-gray-200 rounded-md">Cancelar</button>
                    <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-md">Salvar</button>
                </div>
            </div>
        </div>
    );
};

const InteractiveCompensationReport: React.FC<Props> = ({ reservations, deposits, manualAdjustments, setManualAdjustments, manualConciliations, onSaveConciliations, dismissedAutoMatches = [], onRestoreAutoMatch, initialSelectedReservationId, onInitialSelectionConsumed }) => {
    
    const [selectedReservationIds, setSelectedReservationIds] = useState<Set<string>>(new Set());
    const [selectedDepositIds, setSelectedDepositIds] = useState<Set<string>>(new Set());
    const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);
    const [startTour, setStartTour] = useState(false);

    // Atalho de "Competência × Caixa": pré-seleciona a reserva enviada via prop.
    useEffect(() => {
        if (initialSelectedReservationId) {
            setSelectedReservationIds(new Set([initialSelectedReservationId]));
            onInitialSelectionConsumed?.();
        }
    }, [initialSelectedReservationId, onInitialSelectionConsumed]);

    const [smartSuggestions, setSmartSuggestions] = useState<Reservation[][]>([]);
    const [showSuggestionsModal, setShowSuggestionsModal] = useState(false);

    const [depositStartDate, setDepositStartDate] = useState<string>('');
    const [depositEndDate, setDepositEndDate] = useState<string>('');
    const [depositTypeFilter, setDepositTypeFilter] = useState<string>('');
    const [reservationStartDate, setReservationStartDate] = useState<string>('');
    const [reservationEndDate, setReservationEndDate] = useState<string>('');
    const [reservationPlatformFilter, setReservationPlatformFilter] = useState<string>('');

    useEffect(() => {
        if (startTour) {
            const intro = introJs();
            intro.setOptions({
                steps: [
                    {
                        element: '[data-tour-interactive="title"]',
                        title: 'Desconto Individual ✍️',
                        intro: 'Esta é sua ferramenta para <strong>conciliar manualmente</strong> depósitos e hospedagens que o sistema não conseguiu combinar. Suas ações aqui são salvas na nuvem.',
                        position: 'bottom'
                    },
                    {
                        element: '[data-tour-interactive="deposits-list"]',
                        title: '1. Selecione um ou mais Depósitos 🏦',
                        intro: 'Clique na caixa de seleção ao lado dos <strong>depósitos</strong> que você deseja conciliar. O total selecionado aparecerá acima da lista.',
                        position: 'right'
                    },
                    {
                        element: '[data-tour-interactive="reservations-list"]',
                        title: '2. Selecione uma ou mais Hospedagens 🏨',
                        intro: 'Agora, faça o mesmo para as <strong>hospedagens</strong> correspondentes. Você pode usar o botão "Ajustar" para corrigir valores, se necessário.',
                        position: 'left'
                    },
                    {
                        element: '[data-tour-interactive="conciliate-button"]',
                        title: '3. Concilie! ✅',
                        intro: 'Quando os totais selecionados estiverem corretos, clique neste botão para <strong>criar a associação</strong>. Os itens desaparecerão das listas de pendentes.',
                        position: 'left'
                    },
                    {
                        element: '[data-tour-interactive="manual-list"]',
                        title: 'Suas Conciliações 📋',
                        intro: 'Todas as associações que você criar aparecerão aqui. Você pode <strong>"Desfazer"</strong> uma conciliação a qualquer momento se cometer um erro.',
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


    const getAdjustedNet = useCallback((res: Reservation) => res.netEarnings - (manualAdjustments[res.id] || 0), [manualAdjustments]);

    const handleSaveAdjustment = (id: string, discount: number) => {
        setManualAdjustments(prev => ({ ...prev, [id]: discount }));
    };

    const autoConciliationResult = useMemo(() => {
        const { matchedPairs } = performAutoReconciliation(reservations, deposits, manualAdjustments);
        
        const dismissedResIds = new Set<string>();
        const dismissedDepIds = new Set<string>();
        
        const finalMatchedPairs = matchedPairs.filter(pair => {
            const isDismissed = (dismissedAutoMatches || []).some(d => 
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

        const autoConciliatedReservationIds = new Set(finalMatchedPairs.flatMap(p => p.reservations.map(r => r.id)));
        const autoConciliatedDepositIds = new Set(finalMatchedPairs.map(p => p.deposit.id));
        return { autoConciliatedReservationIds, autoConciliatedDepositIds };
    }, [reservations, deposits, manualAdjustments, dismissedAutoMatches]);

    const hydratedManualConciliations: HydratedManualConciliation[] = useMemo(() => {
        return manualConciliations.map(mc => ({
            ...mc,
            reservations: reservations.filter(r => mc.reservationIds.includes(r.id)),
            deposits: deposits.filter(d => mc.depositIds.includes(d.id)),
        }));
    }, [manualConciliations, reservations, deposits]);

    const hydratedDismissedMatches = useMemo(() => {
        return (dismissedAutoMatches || []).map(dm => {
            const deposit = deposits.find(d => d.id === dm.depositId);
            const res = reservations.filter(r => dm.reservationIds.includes(r.id));
            return { ...dm, deposit, reservations: res };
        });
    }, [dismissedAutoMatches, deposits, reservations]);

    const manualConciliatedReservationIds = useMemo(() => new Set(manualConciliations.flatMap(c => c.reservationIds)), [manualConciliations]);
    const manualConciliatedDepositIds = useMemo(() => new Set(manualConciliations.flatMap(c => c.depositIds)), [manualConciliations]);

    const pendingReservations = useMemo(() => {
        return reservations
            .filter(r => {
                const isCandidate = r.flat !== '301' && r.platform !== 'Particular';
                const isAutoConciliated = autoConciliationResult.autoConciliatedReservationIds.has(r.id);
                const isManuallyConciliated = manualConciliatedReservationIds.has(r.id);
                
                let dateMatch = true;
                if (reservationStartDate) {
                    dateMatch = dateMatch && r.checkIn >= new Date(reservationStartDate + 'T00:00:00');
                }
                if (reservationEndDate) {
                    dateMatch = dateMatch && r.checkIn <= new Date(reservationEndDate + 'T23:59:59');
                }

                let platformMatch = true;
                if (reservationPlatformFilter) {
                    platformMatch = r.platform.toLowerCase().includes(reservationPlatformFilter.toLowerCase());
                }

                return isCandidate && !isAutoConciliated && !isManuallyConciliated && dateMatch && platformMatch;
            })
            .sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime());
    }, [reservations, autoConciliationResult.autoConciliatedReservationIds, manualConciliatedReservationIds, reservationStartDate, reservationEndDate, reservationPlatformFilter]);

    const pendingDeposits = useMemo(() => {
        return deposits
            .filter(d => {
                const isAutoConciliated = autoConciliationResult.autoConciliatedDepositIds.has(d.id);
                const isManuallyConciliated = manualConciliatedDepositIds.has(d.id);
                
                let dateMatch = true;
                if (depositStartDate) {
                    dateMatch = dateMatch && d.date >= new Date(depositStartDate + 'T00:00:00');
                }
                if (depositEndDate) {
                    dateMatch = dateMatch && d.date <= new Date(depositEndDate + 'T23:59:59');
                }

                let typeMatch = true;
                if (depositTypeFilter) {
                    typeMatch = d.description.toLowerCase().includes(depositTypeFilter.toLowerCase());
                }

                return !isAutoConciliated && !isManuallyConciliated && dateMatch && typeMatch;
            })
            .sort((a, b) => a.date.getTime() - b.date.getTime());
    }, [deposits, autoConciliationResult.autoConciliatedDepositIds, manualConciliatedDepositIds, depositStartDate, depositEndDate, depositTypeFilter]);

    useEffect(() => {
        if (selectedDepositIds.size > 0 || selectedReservationIds.size > 0) return;
        
        for (const dep of pendingDeposits) {
            const matchingRes = pendingReservations.find(res => 
                Math.abs(getAdjustedNet(res) - dep.amount) <= 0.01
            );
            if (matchingRes) {
                if (!selectedReservationIds.has(matchingRes.id) && !selectedDepositIds.has(dep.id)) {
                    setSelectedReservationIds(new Set([matchingRes.id]));
                    setSelectedDepositIds(new Set([dep.id]));
                }
                break;
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingDeposits, pendingReservations, getAdjustedNet]); 

    const findMatchingSubsets = useCallback((
      items: Reservation[],
      target: number,
      maxItems = 6,
      tolerance = 0.02
    ): Reservation[][] => {
      const results: Reservation[][] = [];

      const search = (start: number, current: Reservation[], currentSum: number) => {
        if (results.length >= 5) return; // Limitar a 5 sugestões
        if (Math.abs(currentSum - target) <= tolerance) {
          results.push([...current]);
          return;
        }
        if (current.length >= maxItems || currentSum > target + tolerance) return;
        for (let i = start; i < items.length; i++) {
          const val = getAdjustedNet(items[i]);
          search(i + 1, [...current, items[i]], currentSum + val);
        }
      };

      search(0, [], 0);
      return results;
    }, [getAdjustedNet]);

    const scoreSuggestion = useCallback((
      suggestion: Reservation[],
      depositDate: Date,
      platform: 'BOOKING' | 'AIRBNB' | 'OTHER'
    ): number => {
      const scores = suggestion.map(r => {
        const checkIn = r.checkIn;
        const diffDays = (depositDate.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24);

        if (platform === 'BOOKING') {
          // Ideal: check-in no mês anterior ao depósito (15–60 dias antes)
          const idealMin = 15;
          const idealMax = 60;
          if (diffDays >= idealMin && diffDays <= idealMax) return 0;
          return Math.min(Math.abs(diffDays - idealMin), Math.abs(diffDays - idealMax));
        }

        if (platform === 'AIRBNB') {
          // Ideal: check-in 1–3 dias antes do depósito
          const idealMin = 1;
          const idealMax = 3;
          if (diffDays >= idealMin && diffDays <= idealMax) return 0;
          return Math.min(Math.abs(diffDays - idealMin), Math.abs(diffDays - idealMax));
        }

        // Outras plataformas: sem preferência
        return Math.abs(diffDays);
      });

      // Score da sugestão = média dos scores individuais
      return scores.reduce((a, b) => a + b, 0) / scores.length;
    }, []);

    useEffect(() => {
      // Só ativa quando exatamente 1 depósito selecionado e nenhuma hospedagem
      if (selectedDepositIds.size !== 1 || selectedReservationIds.size > 0) {
        setSmartSuggestions([]);
        return;
      }
      if (pendingReservations.length > 80) {
        setSmartSuggestions([]);
        return;
      }
      const dep = pendingDeposits.find(d => selectedDepositIds.has(d.id));
      if (!dep) return;

      const depositDesc = dep.description.toUpperCase();
      let eligibleReservations = pendingReservations;

      const scoringPlatform: 'BOOKING' | 'AIRBNB' | 'OTHER' =
        depositDesc.includes('BOOKING.COM') ? 'BOOKING' :
        depositDesc.includes('BANCO INTER') ? 'AIRBNB' : 'OTHER';

      if (depositDesc.includes('BOOKING.COM')) {
        eligibleReservations = pendingReservations.filter(r =>
          r.platform.toUpperCase().includes('BOOKING')
        );
      } else if (depositDesc.includes('BANCO INTER')) {
        eligibleReservations = pendingReservations.filter(r =>
          r.platform.toUpperCase().includes('AIRBNB')
        );
      }

      const suggestions = findMatchingSubsets(eligibleReservations, dep.amount)
        .map(s => ({ suggestion: s, score: scoreSuggestion(s, dep.date, scoringPlatform) }))
        .sort((a, b) => a.score - b.score)
        .map(s => s.suggestion);

      if (suggestions.length > 0) {
        setSmartSuggestions(suggestions);
        setShowSuggestionsModal(true);
      } else {
        setSmartSuggestions([]);
      }
    }, [selectedDepositIds, selectedReservationIds, pendingDeposits, pendingReservations, findMatchingSubsets, scoreSuggestion]);

    const handleApplySuggestion = (suggestion: Reservation[]) => {
      setSelectedReservationIds(new Set(suggestion.map(r => r.id)));
      setShowSuggestionsModal(false);
      setSmartSuggestions([]);
    };
    
    const handleToggleSelection = (id: string, type: 'deposit' | 'reservation') => {
        const selectedIds = type === 'deposit' ? selectedDepositIds : selectedReservationIds;
        const setter = type === 'deposit' ? setSelectedDepositIds : setSelectedReservationIds;
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setter(newSet);
    };
    
    const { totalSelectedReservations, totalSelectedDeposits } = useMemo(() => {
        const resTotal = pendingReservations
            .filter(r => selectedReservationIds.has(r.id))
            .reduce((sum, r) => sum + getAdjustedNet(r), 0);
        const depTotal = pendingDeposits
            .filter(d => selectedDepositIds.has(d.id))
            .reduce((sum, d) => sum + d.amount, 0);
        return { totalSelectedReservations: resTotal, totalSelectedDeposits: depTotal };
    }, [selectedReservationIds, selectedDepositIds, pendingReservations, pendingDeposits, getAdjustedNet]);

    const handleConciliation = () => {
        const depositsToConciliate = pendingDeposits.filter(d => selectedDepositIds.has(d.id));
        const reservationsToConciliate = pendingReservations.filter(r => selectedReservationIds.has(r.id));

        if (depositsToConciliate.length === 0 || reservationsToConciliate.length === 0) return;

        const difference = totalSelectedDeposits - totalSelectedReservations;
        
        if (Math.abs(difference) > 0.01) {
            const confirmed = window.confirm(
                `Os totais não batem! (Diferença de ${formatCurrency(difference)}).\n\nDeseja registrar essa diferença como um ajuste e conciliar mesmo assim?`
            );
            if (!confirmed) return;
        }

        const newConciliation: ManualConciliation = {
            id: `manual-${Date.now()}`,
            reservationIds: reservationsToConciliate.map(r => r.id),
            depositIds: depositsToConciliate.map(d => d.id),
            adjustment: difference,
        };

        onSaveConciliations([newConciliation, ...manualConciliations]);
        setSelectedReservationIds(new Set());
        setSelectedDepositIds(new Set());
    };

    const handleUndoConciliation = (id: string) => {
        const updatedConciliations = manualConciliations.filter(c => c.id !== id);
        onSaveConciliations(updatedConciliations);
    };
    
    const getDateBadge = (score: number) => {
      if (score === 0) return <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">✅ Datas ideais</span>;
      if (score <= 7) return <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full">⚠️ Datas próximas</span>;
      return <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">📅 Datas distantes</span>;
    };

    return (
        <div className="space-y-6">
            {editingReservation && (
                <AdjustmentModal
                    reservation={editingReservation}
                    onClose={() => setEditingReservation(null)}
                    onSave={handleSaveAdjustment}
                    currentDiscount={manualAdjustments[editingReservation.id] || 0}
                />
            )}

            {showSuggestionsModal && smartSuggestions.length > 0 && (
              <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50">
                <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
                  <h3 className="text-lg font-bold mb-1">🔍 Combinações encontradas</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    O sistema encontrou <strong>{smartSuggestions.length}</strong> combinação(ões) de hospedagens
                    que somam <strong>{formatCurrency(pendingDeposits.find(d => selectedDepositIds.has(d.id))?.amount || 0)}</strong>.
                  </p>

                  <div className="space-y-3">
                    {smartSuggestions.map((suggestion, index) => {
                      const dep = pendingDeposits.find(d => selectedDepositIds.has(d.id));
                      const depositDesc = dep?.description.toUpperCase() || '';
                      const scoringPlatform: 'BOOKING' | 'AIRBNB' | 'OTHER' =
                        depositDesc.includes('BOOKING.COM') ? 'BOOKING' :
                        depositDesc.includes('BANCO INTER') ? 'AIRBNB' : 'OTHER';
                      const score = dep ? scoreSuggestion(suggestion, dep.date, scoringPlatform) : 100;

                      return (
                        <div key={index} className="border border-gray-200 rounded-md p-3 bg-gray-50">
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-700">Sugestão {index + 1}</span>
                              {getDateBadge(score)}
                            </div>
                            <button
                              onClick={() => handleApplySuggestion(suggestion)}
                              className="px-3 py-1 bg-purple-600 text-white text-sm rounded hover:bg-purple-700"
                            >
                              Aplicar
                            </button>
                          </div>
                          <ul className="space-y-1">
                            {suggestion.map(r => (
                              <li key={r.id} className="text-sm text-gray-600 flex justify-between">
                                <span>• {r.guestName} — {r.platform}</span>
                                <span className="font-medium">{formatCurrency(getAdjustedNet(r))}</span>
                              </li>
                            ))}
                          </ul>
                          <div className="mt-2 pt-2 border-t border-gray-200 flex justify-between text-sm font-bold">
                            <span>Total</span>
                            <span className="text-green-700">
                              {formatCurrency(suggestion.reduce((s, r) => s + getAdjustedNet(r), 0))} ✅
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={() => { setShowSuggestionsModal(false); setSmartSuggestions([]); }}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm"
                    >
                      Fechar — selecionar manualmente
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-white p-6 rounded-lg shadow-md flex flex-col md:flex-row justify-between md:items-center gap-4">
                <div data-tour-interactive="title">
                     <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-gray-700" title="Ferramenta interativa para conciliar manualmente depósitos e hospedagens que o sistema não conseguiu combinar automaticamente.">DESCONTO INDIVIDUAL (MESA DE TRABALHO)</h2>
                         <button onClick={() => setStartTour(true)} title="Ajuda sobre este relatório" className="bg-blue-100 text-blue-700 p-2 rounded-full hover:bg-blue-200 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.546-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </button>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">Selecione os depósitos e hospedagens e clique em "Conciliar". Seu trabalho é salvo na nuvem.</p>
                </div>
                 <button
                    onClick={handleConciliation}
                    disabled={selectedDepositIds.size === 0 || selectedReservationIds.size === 0}
                    className="bg-purple-600 text-white font-bold py-3 px-6 rounded-lg shadow-md hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-transform duration-150 transform hover:scale-105"
                    data-tour-interactive="conciliate-button"
                >
                    Conciliar Selecionados
                </button>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-[65vh]">
                <div className="bg-gray-50 p-4 rounded-lg flex flex-col" data-tour-interactive="deposits-list">
                    <div className="sticky top-0 bg-gray-50 pb-2 z-10">
                        <h3 className="text-lg font-bold text-gray-800" title="Esta lista contém todos os depósitos bancários que ainda não foram associados a nenhuma hospedagem (automática ou manualmente).">Depósitos Pendentes ({pendingDeposits.length})</h3>
                        <div className="flex flex-col gap-2 mt-2">
                            <div className="flex gap-2">
                                <input 
                                    type="date" 
                                    value={depositStartDate} 
                                    onChange={(e) => setDepositStartDate(e.target.value)} 
                                    className="text-sm border border-gray-300 rounded-md px-2 py-1 flex-1"
                                    title="Data inicial"
                                />
                                <input 
                                    type="date" 
                                    value={depositEndDate} 
                                    onChange={(e) => setDepositEndDate(e.target.value)} 
                                    className="text-sm border border-gray-300 rounded-md px-2 py-1 flex-1"
                                    title="Data final"
                                />
                            </div>
                            <select
                                value={depositTypeFilter}
                                onChange={(e) => setDepositTypeFilter(e.target.value)}
                                className="text-sm border border-gray-300 rounded-md px-2 py-1 w-full"
                                title="Filtrar por tipo de depósito"
                            >
                                <option value="">Todos os tipos</option>
                                <option value="TED RECEBIDA - BOOKING.COM">TED RECEBIDA - BOOKING.COM</option>
                                <option value="TRANSFERÊNCIA A CRÉDITO VIA PIX - BANCO INTER">TRANSFERÊNCIA A CRÉDITO VIA PIX - BANCO INTER</option>
                            </select>
                        </div>
                        {selectedDepositIds.size > 0 && 
                            <div className={`mt-2 p-2 rounded-md text-center border bg-blue-50 border-blue-200`}>
                                <span className="font-semibold">{selectedDepositIds.size} selecionado(s)</span>
                                <span className={`text-xl font-bold ml-4 text-blue-800`}>{formatCurrency(totalSelectedDeposits)}</span>
                            </div>
                        }
                    </div>
                    <div className="space-y-3 overflow-y-auto mt-2">
                        {pendingDeposits.map(dep => (
                           <div key={dep.id} className="flex items-center space-x-3 p-2 rounded-md bg-white border border-gray-200 shadow-sm has-[:checked]:bg-blue-100 has-[:checked]:border-blue-400">
                               <input type="checkbox" className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0" checked={selectedDepositIds.has(dep.id)} onChange={() => handleToggleSelection(dep.id, 'deposit')} />
                               <label className="flex justify-between items-center w-full cursor-pointer">
                                   <div className="text-sm">
                                       <p className="font-semibold">{dep.description || "Sem descrição"}</p>
                                       <p className="text-gray-500">{formatDate(dep.date)}</p>
                                   </div>
                                   <p className="font-bold text-lg text-blue-600">{formatCurrency(dep.amount)}</p>
                               </label>
                           </div>
                        ))}
                         {pendingDeposits.length === 0 && (
                            <p className="text-center text-gray-500 pt-4">Nenhum depósito pendente.</p>
                        )}
                    </div>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg flex flex-col" data-tour-interactive="reservations-list">
                    <div className="sticky top-0 bg-gray-50 pb-2 z-10">
                        <h3 className="text-lg font-bold text-gray-800" title="Esta lista contém todas as hospedagens que ainda não foram associadas a nenhum depósito bancário (automática ou manualmente).">Hospedagens Pendentes ({pendingReservations.length})</h3>
                        <div className="flex flex-col gap-2 mt-2">
                            <div className="flex gap-2">
                                <input 
                                    type="date" 
                                    value={reservationStartDate} 
                                    onChange={(e) => setReservationStartDate(e.target.value)} 
                                    className="text-sm border border-gray-300 rounded-md px-2 py-1 flex-1"
                                    title="Data de check-in inicial"
                                />
                                <input 
                                    type="date" 
                                    value={reservationEndDate} 
                                    onChange={(e) => setReservationEndDate(e.target.value)} 
                                    className="text-sm border border-gray-300 rounded-md px-2 py-1 flex-1"
                                    title="Data de check-in final"
                                />
                            </div>
                            <select
                                value={reservationPlatformFilter}
                                onChange={(e) => setReservationPlatformFilter(e.target.value)}
                                className="text-sm border border-gray-300 rounded-md px-2 py-1 w-full"
                                title="Filtrar por plataforma"
                            >
                                <option value="">Todas as plataformas</option>
                                <option value="airbnb">Airbnb</option>
                                <option value="booking">Booking</option>
                            </select>
                        </div>
                        {selectedReservationIds.size > 0 && 
                             <div className={`mt-2 p-2 rounded-md text-center border bg-green-50 border-green-200`}>
                                <span className="font-semibold">{selectedReservationIds.size} selecionado(s)</span>
                                <span className={`text-xl font-bold ml-4 text-green-800`}>{formatCurrency(totalSelectedReservations)}</span>
                            </div>
                        }
                    </div>
                    <div className="space-y-3 overflow-y-auto mt-2">
                         {pendingReservations.map(res => (
                            <div key={res.id} className="flex items-center space-x-3 p-2 rounded-md bg-white border border-gray-200 shadow-sm has-[:checked]:bg-green-100 has-[:checked]:border-green-400">
                                <input
                                    type="checkbox"
                                    id={`res-${res.id}`}
                                    className="h-5 w-5 rounded border-gray-300 text-green-600 focus:ring-green-500 flex-shrink-0"
                                    checked={selectedReservationIds.has(res.id)}
                                    onChange={() => handleToggleSelection(res.id, 'reservation')}
                                />
                                <div className="flex justify-between items-center w-full">
                                    <label htmlFor={`res-${res.id}`} className="cursor-pointer text-sm">
                                        <p className="font-semibold">{res.guestName} ({res.flat})</p>
                                        <p className="text-xs font-semibold text-slate-500">{res.platform}</p>
                                        <p className="text-gray-500">Check-in: {formatDate(res.checkIn)}</p>
                                    </label>
                                    <div className="text-right">
                                        <p className="font-bold text-lg text-green-600">{formatCurrency(getAdjustedNet(res))}</p>
                                        <button
                                            onClick={() => setEditingReservation(res)}
                                            className="text-blue-600 hover:underline text-xs font-semibold"
                                        >
                                            Ajustar
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                         {pendingReservations.length === 0 && (
                            <p className="text-center text-gray-500 pt-4">Nenhuma hospedagem pendente.</p>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white p-4 rounded-lg shadow-md" data-tour-interactive="manual-list">
                    <h3 className="text-lg font-bold text-gray-700" title="Esta seção exibe um histórico de todas as conciliações que você realizou manualmente. Você pode desfazer uma conciliação a qualquer momento.">Itens Conciliados Manualmente ({hydratedManualConciliations.length})</h3>
                    {hydratedManualConciliations.length === 0 ? <p className="text-sm text-gray-500 mt-2">Nenhum item conciliado manualmente ainda.</p> :
                        <div className="space-y-3 mt-2 max-h-48 overflow-y-auto">
                            {hydratedManualConciliations.map(item => (
                                <div key={item.id} className="p-3 bg-gray-100 border rounded-md flex justify-between items-center">
                                    <div>
                                        <p className="font-bold text-sm text-gray-800">
                                            {item.reservations.map(r => r.guestName).join(' + ')}
                                        </p>
                                        <div className="text-xs text-gray-500 mt-1">
                                            {item.adjustment !== 0 && (
                                                <p className={`font-semibold ${item.adjustment > 0 ? 'text-green-600' : 'text-yellow-600'}`}>
                                                    Ajuste: {formatCurrency(item.adjustment)}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => handleUndoConciliation(item.id)}
                                        className="text-red-500 hover:text-red-700 text-xs font-semibold px-2 py-1 rounded hover:bg-red-100"
                                        title="Desfazer esta conciliação"
                                    >
                                        Desfazer
                                    </button>
                                </div>
                            ))}
                        </div>
                    }
                </div>

                <div className="bg-white p-4 rounded-lg shadow-md">
                    <h3 className="text-lg font-bold text-gray-700" title="Esta seção exibe as conciliações automáticas que você descartou. Você pode restaurá-las a qualquer momento.">Auto-conciliações Descartadas ({hydratedDismissedMatches.length})</h3>
                    {hydratedDismissedMatches.length === 0 ? <p className="text-sm text-gray-500 mt-2">Nenhuma conciliação automática descartada.</p> :
                        <div className="space-y-3 mt-2 max-h-48 overflow-y-auto">
                            {hydratedDismissedMatches.map(item => (
                                <div key={item.id} className="p-3 bg-gray-100 border rounded-md flex justify-between items-center">
                                    <div>
                                        <p className="font-bold text-sm text-gray-800">
                                            {item.reservations.map(r => r.guestName).join(' + ')}
                                        </p>
                                        <div className="text-xs text-gray-500 mt-1">
                                            <p>Depósito: {item.deposit?.description || 'Desconhecido'} ({formatCurrency(item.deposit?.amount || 0)})</p>
                                        </div>
                                    </div>
                                    {onRestoreAutoMatch && (
                                        <button 
                                            onClick={() => onRestoreAutoMatch(item.id)}
                                            className="text-blue-500 hover:text-blue-700 text-xs font-semibold px-2 py-1 rounded hover:bg-blue-100"
                                            title="Restaurar esta conciliação automática"
                                        >
                                            Restaurar
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    }
                </div>
            </div>
        </div>
    );
};

export default InteractiveCompensationReport;
