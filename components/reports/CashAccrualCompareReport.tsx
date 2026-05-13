import React, { useMemo, useState, useCallback } from 'react';
import { Reservation, BankDeposit, MatchedPair, ManualConciliation } from '../../types';
import { formatCurrency, formatDate, getMonthName } from '../../utils/helpers';
import { performAutoReconciliation } from '../../utils/reconciliation';
import { getReservationRevenue } from '../../utils/feeMode';

interface Props {
    reservations: Reservation[];
    deposits: BankDeposit[];
    manualAdjustments: Record<string, number>;
    manualConciliations: ManualConciliation[];
    selectedYear: number;
    selectedMonth: number;
    /** Atalho: navega para Conciliação Manual com a reserva pré-selecionada. */
    onJumpToManualConciliation: (reservationId: string) => void;
}

type RowStatus =
    | { kind: 'paid_same_month'; depositDate: Date }
    | { kind: 'paid_other_month'; depositDate: Date }
    | { kind: 'divergent'; depositDate: Date; difference: number }
    | { kind: 'pending' }
    | { kind: 'particular' };

interface ReservationRow {
    reservation: Reservation;
    expected: number;     // Receita esperada (segundo critério do ano)
    received: number;     // Quanto efetivamente caiu (proporcional, se depósito agrupado)
    status: RowStatus;
    matchedDepositId?: string;
}

const KpiCard: React.FC<{ title: string; value: string; tone?: 'default' | 'success' | 'warning' | 'danger'; subtitle?: string }> = ({ title, value, tone = 'default', subtitle }) => {
    const toneClasses = {
        default: 'text-slate-800 dark:text-slate-100',
        success: 'text-green-600',
        warning: 'text-amber-600',
        danger: 'text-red-600',
    }[tone];
    return (
        <div className="card p-4">
            <h4 className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</h4>
            <p className={`text-2xl font-bold mt-1 ${toneClasses}`}>{value}</p>
            {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
        </div>
    );
};

const StatusBadge: React.FC<{ status: RowStatus; selectedYear: number; selectedMonth: number }> = ({ status, selectedYear, selectedMonth }) => {
    switch (status.kind) {
        case 'paid_same_month':
            return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">✅ Pago em {getMonthName(selectedMonth).slice(0,3)}/{String(selectedYear).slice(-2)}</span>;
        case 'paid_other_month': {
            const m = status.depositDate.getUTCMonth() + 1;
            const y = status.depositDate.getUTCFullYear();
            return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">✅ Pago em {getMonthName(m).slice(0,3)}/{String(y).slice(-2)}</span>;
        }
        case 'divergent':
            return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">⚠️ Divergência: {formatCurrency(status.difference)}</span>;
        case 'pending':
            return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-200 text-slate-700">⏳ Aguardando depósito</span>;
        case 'particular':
            return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">🔵 Particular (não passa pelo banco)</span>;
    }
};

const CashAccrualCompareReport: React.FC<Props> = ({
    reservations,
    deposits,
    manualAdjustments,
    manualConciliations,
    selectedYear,
    selectedMonth,
    onJumpToManualConciliation,
}) => {
    const availableFlats = useMemo(() => ['201', '202', '301'], []);
    const [selectedFlats, setSelectedFlats] = useState<string[]>(['201', '202']);
    const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);

    const handleFlatSelectionChange = useCallback((flat: string) => {
        setSelectedFlats(prev => prev.includes(flat) ? prev.filter(f => f !== flat) : [...prev, flat]);
    }, []);

    // 1) Faz a reconciliação completa (auto + Pre-defined etc.)
    const allMatchedPairs = useMemo<MatchedPair[]>(() => {
        return performAutoReconciliation(reservations || [], deposits || [], manualAdjustments || {}).matchedPairs;
    }, [reservations, deposits, manualAdjustments]);

    // 2) Mapa: reservationId -> depósito (do auto-match)
    // 3) Mapa: reservationId -> depósito (do manual)
    const { autoMap, manualMap } = useMemo(() => {
        const autoMap = new Map<string, { deposit: BankDeposit; pair: MatchedPair }>();
        allMatchedPairs.forEach(pair => {
            pair.reservations.forEach(res => {
                autoMap.set(res.id, { deposit: pair.deposit, pair });
            });
        });
        // Manual: agrega TODOS os depósitos da conciliação (não só o primeiro).
        // Se a conciliação tem N depósitos para M reservas, cada reserva está
        // associada à soma dos N depósitos. Data de referência = a mais antiga.
        const manualMap = new Map<string, { deposit: BankDeposit; siblingReservationIds: string[] }>();
        const depositsById = new Map((deposits || []).map(d => [d.id, d]));
        (manualConciliations || []).forEach(mc => {
            const depositsOfMc = (mc.depositIds || [])
                .map(id => depositsById.get(id))
                .filter((d): d is BankDeposit => !!d);
            if (depositsOfMc.length === 0) {
                // Importante para diagnóstico: a conciliação manual existe mas
                // os depósitos referenciados não foram encontrados na lista
                // atual (ex: depósito apagado, ID dessincronizado).
                // eslint-disable-next-line no-console
                console.warn('[CashAccrualCompare] Conciliação manual sem depósitos encontrados:', mc.id, mc.depositIds);
                return;
            }
            const totalAmount = depositsOfMc.reduce((s, d) => s + d.amount, 0);
            const earliestDate = depositsOfMc.reduce((min, d) => d.date < min ? d.date : min, depositsOfMc[0].date);
            // Aplico ajuste manual da conciliação (mc.adjustment) ao valor total
            const adjustedAmount = totalAmount - (mc.adjustment || 0);
            const aggregateDeposit: BankDeposit = {
                id: depositsOfMc[0].id, // ID do primeiro só para referência interna
                date: earliestDate,
                description: depositsOfMc.map(d => d.description).join(' + '),
                amount: adjustedAmount,
            };
            mc.reservationIds.forEach(rid => {
                manualMap.set(rid, { deposit: aggregateDeposit, siblingReservationIds: mc.reservationIds });
            });
        });
        return { autoMap, manualMap };
    }, [allMatchedPairs, manualConciliations, deposits]);

    // 4) Reservas do mês de competência (check-in no mês)
    const monthlyReservations = useMemo(() => {
        return (reservations || []).filter(r =>
            selectedFlats.includes(r.flat) &&
            r.checkIn.getUTCFullYear() === selectedYear &&
            r.checkIn.getUTCMonth() + 1 === selectedMonth
        );
    }, [reservations, selectedYear, selectedMonth, selectedFlats]);

    // 5) Para cada reserva, calcula esperado/recebido/status
    //    PRIORIDADE: manual > auto. Conciliação manual é decisão explícita do usuário
    //    e deve sobrescrever qualquer match automático que possa ter sido inferido.
    const rows: ReservationRow[] = useMemo(() => {
        return monthlyReservations.map(res => {
            const expected = getReservationRevenue(res, selectedYear);

            // Particular: dono recebe direto, considera-se pago.
            if (res.platform === 'Particular') {
                return {
                    reservation: res,
                    expected,
                    received: expected,
                    status: { kind: 'particular' as const },
                };
            }

            // Manual (prioridade)
            const manual = manualMap.get(res.id);
            if (manual) {
                // Mesma lógica de divisão proporcional, mas usando os irmãos manuais
                const siblings = (reservations || []).filter(r => manual.siblingReservationIds.includes(r.id));
                const totalNet = siblings.reduce((s, r) => s + Math.max(r.netEarnings, 0), 0);
                const ratio = totalNet > 0 ? Math.max(res.netEarnings, 0) / totalNet : 1 / Math.max(siblings.length, 1);
                const received = manual.deposit.amount * ratio;
                const depositDate = manual.deposit.date;
                const sameMonth = depositDate.getUTCFullYear() === selectedYear && (depositDate.getUTCMonth() + 1) === selectedMonth;
                const diff = received - expected;
                if (Math.abs(diff) > 0.5) {
                    return {
                        reservation: res,
                        expected,
                        received,
                        status: { kind: 'divergent' as const, depositDate, difference: diff },
                        matchedDepositId: manual.deposit.id,
                    };
                }
                return {
                    reservation: res,
                    expected,
                    received,
                    status: sameMonth
                        ? { kind: 'paid_same_month' as const, depositDate }
                        : { kind: 'paid_other_month' as const, depositDate },
                    matchedDepositId: manual.deposit.id,
                };
            }

            // Auto-match
            const auto = autoMap.get(res.id);
            if (auto) {
                const pair = auto.pair;
                // Para depósitos agrupados (Sum / Pre-defined), divido proporcionalmente
                // pelo netEarnings (porque é nessa base que o depósito casa).
                let received: number;
                if (pair.reservations.length === 1) {
                    received = pair.deposit.amount;
                } else {
                    const totalNet = pair.reservations.reduce((s, r) => s + Math.max(r.netEarnings, 0), 0);
                    const ratio = totalNet > 0 ? Math.max(res.netEarnings, 0) / totalNet : 1 / pair.reservations.length;
                    received = pair.deposit.amount * ratio;
                }
                const depositDate = auto.deposit.date;
                const sameMonth = depositDate.getUTCFullYear() === selectedYear && (depositDate.getUTCMonth() + 1) === selectedMonth;
                const diff = received - expected;
                if (Math.abs(diff) > 0.5) {
                    return {
                        reservation: res,
                        expected,
                        received,
                        status: { kind: 'divergent' as const, depositDate, difference: diff },
                        matchedDepositId: auto.deposit.id,
                    };
                }
                return {
                    reservation: res,
                    expected,
                    received,
                    status: sameMonth
                        ? { kind: 'paid_same_month' as const, depositDate }
                        : { kind: 'paid_other_month' as const, depositDate },
                    matchedDepositId: auto.deposit.id,
                };
            }

            // Sem match
            return {
                reservation: res,
                expected,
                received: 0,
                status: { kind: 'pending' as const },
            };
        });
    }, [monthlyReservations, autoMap, manualMap, reservations, selectedYear, selectedMonth]);

    // 6) Agrupar por plataforma
    const byPlatform = useMemo<Record<string, ReservationRow[]>>(() => {
        const groups: Record<string, ReservationRow[]> = {};
        rows.forEach(r => {
            const k = r.reservation.platform || 'Outros';
            if (!groups[k]) groups[k] = [];
            groups[k].push(r);
        });
        return groups;
    }, [rows]);

    // 7) Totais
    const totals = useMemo(() => {
        const expected = rows.reduce((s, r) => s + r.expected, 0);
        const received = rows.reduce((s, r) => s + r.received, 0);
        const pendingCount = rows.filter(r => r.status.kind === 'pending').length;
        const divergentCount = rows.filter(r => r.status.kind === 'divergent').length;
        const pendingValue = rows
            .filter(r => r.status.kind === 'pending')
            .reduce((s, r) => s + r.expected, 0);
        return { expected, received, pendingCount, divergentCount, pendingValue, totalCount: rows.length };
    }, [rows]);

    // 8) Depósitos do mês que NÃO casaram com nenhuma reserva
    const orphanDeposits = useMemo(() => {
        const matchedDepositIds = new Set<string>();
        allMatchedPairs.forEach(p => matchedDepositIds.add(p.deposit.id));
        (manualConciliations || []).forEach(mc => mc.depositIds.forEach(d => matchedDepositIds.add(d)));
        return (deposits || []).filter(d =>
            d.date.getUTCFullYear() === selectedYear &&
            (d.date.getUTCMonth() + 1) === selectedMonth &&
            !matchedDepositIds.has(d.id)
        );
    }, [deposits, allMatchedPairs, manualConciliations, selectedYear, selectedMonth]);

    const statusGeral = useMemo(() => {
        if (totals.divergentCount > 0) return { tone: 'danger' as const, text: '🔴 Divergências detectadas' };
        if (totals.pendingCount > 0) return { tone: 'warning' as const, text: '⚠️ Pagamentos pendentes' };
        if (totals.totalCount === 0) return { tone: 'default' as const, text: '— Sem reservas no mês' };
        return { tone: 'success' as const, text: '✅ Tudo conciliado' };
    }, [totals]);

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Competência × Caixa</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Comparativo entre o que deveria entrar como receita no mês ({getMonthName(selectedMonth)}/{selectedYear}, por data de check-in)
                    e o que efetivamente já foi depositado pelas plataformas.
                </p>
            </div>

            {/* Filtro de flats */}
            <div className="card p-4">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Flats incluídos</h3>
                <div className="flex flex-wrap gap-3">
                    {availableFlats.map(flat => (
                        <label key={flat} className="flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={selectedFlats.includes(flat)}
                                onChange={() => handleFlatSelectionChange(flat)}
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="ml-2 text-sm text-slate-700 dark:text-slate-200">Flat {flat}</span>
                        </label>
                    ))}
                </div>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard title="Receita esperada (competência)" value={formatCurrency(totals.expected)} subtitle={`${totals.totalCount} reserva(s)`} />
                <KpiCard title="Já recebida" value={formatCurrency(totals.received)} tone="success" />
                <KpiCard title="Pendente" value={formatCurrency(totals.pendingValue)} tone={totals.pendingValue > 0 ? 'warning' : 'default'} subtitle={`${totals.pendingCount} reserva(s)`} />
                <KpiCard title="Status geral" value={statusGeral.text} tone={statusGeral.tone} />
            </div>

            {/* Resumo por plataforma */}
            <div className="card p-4">
                <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200 mb-3">Por plataforma</h3>
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-700">
                                <th className="py-2 px-3 text-left">Plataforma</th>
                                <th className="py-2 px-3 text-right">Reservas</th>
                                <th className="py-2 px-3 text-right">Esperado</th>
                                <th className="py-2 px-3 text-right">Recebido</th>
                                <th className="py-2 px-3 text-right">Pendente</th>
                                <th className="py-2 px-3 text-center">Status</th>
                                <th className="py-2 px-3 text-center"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(byPlatform).length === 0 && (
                                <tr><td colSpan={7} className="py-6 text-center text-slate-500">Nenhuma reserva no mês para os flats selecionados.</td></tr>
                            )}
                            {(Object.entries(byPlatform) as [string, ReservationRow[]][]).map(([platform, platformRows]) => {
                                const exp = platformRows.reduce((s, r) => s + r.expected, 0);
                                const rec = platformRows.reduce((s, r) => s + r.received, 0);
                                const pendingRows = platformRows.filter(r => r.status.kind === 'pending');
                                const divergentRows = platformRows.filter(r => r.status.kind === 'divergent');
                                const pend = pendingRows.reduce((s, r) => s + r.expected, 0);
                                let badge: React.ReactNode;
                                if (divergentRows.length > 0) {
                                    badge = <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">⚠️ {divergentRows.length} divergência(s)</span>;
                                } else if (pendingRows.length > 0) {
                                    badge = <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-slate-200 text-slate-700">⏳ {pendingRows.length} pendente(s)</span>;
                                } else {
                                    badge = <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">✅ Conciliado</span>;
                                }
                                return (
                                    <tr key={platform} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                        <td className="py-2 px-3 font-medium">{platform}</td>
                                        <td className="py-2 px-3 text-right">{platformRows.length}</td>
                                        <td className="py-2 px-3 text-right">{formatCurrency(exp)}</td>
                                        <td className="py-2 px-3 text-right text-green-700">{formatCurrency(rec)}</td>
                                        <td className="py-2 px-3 text-right text-amber-700">{pend > 0 ? formatCurrency(pend) : '—'}</td>
                                        <td className="py-2 px-3 text-center">{badge}</td>
                                        <td className="py-2 px-3 text-center">
                                            <button
                                                onClick={() => setExpandedPlatform(expandedPlatform === platform ? null : platform)}
                                                className="text-xs text-blue-600 hover:underline"
                                            >
                                                {expandedPlatform === platform ? 'Ocultar' : 'Ver detalhes'}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Detalhe expandido por plataforma */}
            {expandedPlatform && byPlatform[expandedPlatform] && (
                <div className="card p-4">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">Detalhes — {expandedPlatform}</h3>
                        <button onClick={() => setExpandedPlatform(null)} className="text-xs text-blue-600 hover:underline">Fechar</button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-700">
                                    <th className="py-2 px-3 text-left">Hóspede</th>
                                    <th className="py-2 px-3 text-left">Flat</th>
                                    <th className="py-2 px-3 text-left">Check-in</th>
                                    <th className="py-2 px-3 text-right">Esperado</th>
                                    <th className="py-2 px-3 text-right">Recebido</th>
                                    <th className="py-2 px-3 text-center">Status</th>
                                    <th className="py-2 px-3 text-center"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {byPlatform[expandedPlatform].map(row => (
                                    <tr key={row.reservation.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                        <td className="py-2 px-3">{row.reservation.guestName}</td>
                                        <td className="py-2 px-3">{row.reservation.flat}</td>
                                        <td className="py-2 px-3">{formatDate(row.reservation.checkIn)}</td>
                                        <td className="py-2 px-3 text-right">{formatCurrency(row.expected)}</td>
                                        <td className="py-2 px-3 text-right">{row.received > 0 ? formatCurrency(row.received) : '—'}</td>
                                        <td className="py-2 px-3 text-center">
                                            <StatusBadge status={row.status} selectedYear={selectedYear} selectedMonth={selectedMonth} />
                                        </td>
                                        <td className="py-2 px-3 text-center">
                                            {row.status.kind === 'pending' && (
                                                <button
                                                    onClick={() => onJumpToManualConciliation(row.reservation.id)}
                                                    className="text-xs text-blue-600 hover:underline"
                                                    title="Abrir Conciliação Manual com esta reserva pré-selecionada"
                                                >
                                                    Conciliar →
                                                </button>
                                            )}
                                            {row.status.kind === 'divergent' && (
                                                <button
                                                    onClick={() => onJumpToManualConciliation(row.reservation.id)}
                                                    className="text-xs text-amber-700 hover:underline"
                                                    title="Abrir Conciliação Manual para revisar"
                                                >
                                                    Revisar →
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Bloco: depósitos do mês sem reserva */}
            <div className="card p-4">
                <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200 mb-3">
                    Depósitos do mês sem reserva conciliada
                    <span className="ml-2 text-xs font-normal text-slate-500">({orphanDeposits.length})</span>
                </h3>
                <p className="text-xs text-slate-500 mb-3">
                    Valores que caíram na conta neste mês mas ainda não foram conciliados com nenhuma reserva.
                    Podem ser pagamentos de reservas de outros meses ou conciliações pendentes.
                </p>
                {orphanDeposits.length === 0 ? (
                    <p className="text-sm text-slate-500 italic">Nenhum depósito órfão no mês.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-700">
                                    <th className="py-2 px-3 text-left">Data</th>
                                    <th className="py-2 px-3 text-left">Descrição</th>
                                    <th className="py-2 px-3 text-right">Valor</th>
                                </tr>
                            </thead>
                            <tbody>
                                {orphanDeposits.map(d => (
                                    <tr key={d.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                        <td className="py-2 px-3">{formatDate(d.date)}</td>
                                        <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{d.description}</td>
                                        <td className="py-2 px-3 text-right font-semibold">{formatCurrency(d.amount)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="border-t-2 border-slate-300 dark:border-slate-600 font-semibold">
                                    <td colSpan={2} className="py-2 px-3">Total</td>
                                    <td className="py-2 px-3 text-right">
                                        {formatCurrency(orphanDeposits.reduce((s, d) => s + d.amount, 0))}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CashAccrualCompareReport;
