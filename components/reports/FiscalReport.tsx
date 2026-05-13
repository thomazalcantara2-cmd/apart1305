import React, { useMemo, useState } from 'react';
import {
  Reservation,
  BankDeposit,
  ManualConciliation,
  UnifiedData,
} from '../../types';
import { performAutoReconciliation } from '../../utils/reconciliation';
import {
  formatCurrency,
  formatDate,
  getMonthName,
  exportToExcel,
  sanitizePdfText,
} from '../../utils/helpers';
import {
  SIMPLES_NACIONAL_BRACKETS,
  NFSE_TOMADORES,
  NFSE_PLATAFORMAS_TOMADOR_FIXO,
} from '../../constants';

interface Props {
  reservations: Reservation[];
  deposits: BankDeposit[];
  unifiedData: UnifiedData;
  selectedYear: number;
  selectedMonth: number;
  searchTerm: string;
  manualAdjustments: Record<string, number>;
  manualConciliations: ManualConciliation[];
}

/* ─── helpers ─────────────────────────────────────────────────── */

interface DepositWithMeta {
  deposit: BankDeposit;
  reservations: Reservation[];
  platform: string;
  isConciliated: boolean;
  tomadorLabel: string;
  tomadorCnpj: string;
}

interface MonthCalc {
  month: number;
  revenue: number;
  rbt12: number;
  effectiveRate: number;
  taxDue: number;
}

function getPlatformFromReservations(rsvs: Reservation[]): string {
  if (!rsvs.length) return 'Outros';
  const p = rsvs[0].platform.toUpperCase();
  if (p.includes('AIRBNB')) return 'AIRBNB';
  if (p.includes('BOOKING')) return 'BOOKING';
  if (p.includes('DECOLAR')) return 'DECOLAR';
  return rsvs[0].platform;
}

function getTomador(platform: string): { label: string; cnpj: string } {
  const key = platform.toUpperCase();
  if (NFSE_PLATAFORMAS_TOMADOR_FIXO.includes(key)) {
    const t = NFSE_TOMADORES[key];
    return { label: t.razaoSocial, cnpj: t.cnpj };
  }
  return { label: 'CONSUMIDOR FINAL', cnpj: '' };
}

/* ─── component ───────────────────────────────────────────────── */

const FiscalReport: React.FC<Props> = ({
  reservations,
  deposits,
  selectedYear,
  selectedMonth,
  searchTerm,
  manualAdjustments,
  manualConciliations,
}) => {
  const [activeSection, setActiveSection] = useState<'nfse' | 'simples'>('nfse');

  /* ── conciliation → deposit enrichment ── */
  const { matchedPairs } = useMemo(
    () => performAutoReconciliation(reservations, deposits, manualAdjustments),
    [reservations, deposits, manualAdjustments]
  );

  // Build deposit→reservations map (manual has priority)
  const depositToReservations = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    matchedPairs.forEach(p => map.set(p.deposit.id, p.reservations));
    manualConciliations.forEach(mc => {
      const linked = reservations.filter(r => mc.reservationIds.includes(r.id));
      mc.depositIds.forEach(dId => map.set(dId, linked));
    });
    return map;
  }, [matchedPairs, manualConciliations, reservations]);

  /* ── all conciliated deposits for any year (for RBT12) ── */
  const allConciliatedDeposits = useMemo(() => {
    return deposits.filter(d => depositToReservations.has(d.id));
  }, [deposits, depositToReservations]);

  /* ── deposits of selected month (all — conciliated or not) ── */
  const depositsOfMonth = useMemo<DepositWithMeta[]>(() => {
    return deposits
      .filter(d => {
        const y = d.date.getUTCFullYear() === selectedYear;
        const m = selectedMonth === 0 || d.date.getUTCMonth() + 1 === selectedMonth;
        return y && m;
      })
      .map(d => {
        const rsvs = depositToReservations.get(d.id) || [];
        const isConciliated = depositToReservations.has(d.id);
        const platform = isConciliated ? getPlatformFromReservations(rsvs) : 'Não identificado';
        const { label, cnpj } = getTomador(platform);
        return { deposit: d, reservations: rsvs, platform, isConciliated, tomadorLabel: label, tomadorCnpj: cnpj };
      })
      .sort((a, b) => a.deposit.date.getTime() - b.deposit.date.getTime());
  }, [deposits, selectedYear, selectedMonth, depositToReservations]);

  /* ── filtered for search ── */
  const filteredDeposits = useMemo(() => {
    if (!searchTerm) return depositsOfMonth;
    const q = searchTerm.toLowerCase();
    return depositsOfMonth.filter(
      d =>
        d.deposit.description.toLowerCase().includes(q) ||
        d.reservations.some(r => r.guestName.toLowerCase().includes(q)) ||
        d.platform.toLowerCase().includes(q) ||
        formatCurrency(d.deposit.amount).includes(q)
    );
  }, [depositsOfMonth, searchTerm]);

  /* ── Simples Nacional calculation using conciliated deposits ── */
  const simplesData = useMemo<MonthCalc[]>(() => {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const results: MonthCalc[] = [];

    // Revenue by month from conciliated deposits
    const revenueMap = new Map<string, number>();
    allConciliatedDeposits.forEach(d => {
      const y = d.date.getUTCFullYear();
      const m = d.date.getUTCMonth() + 1;
      const key = `${y}-${m}`;
      revenueMap.set(key, (revenueMap.get(key) || 0) + d.amount);
    });

    const getRevenue = (y: number, m: number) => revenueMap.get(`${y}-${m}`) || 0;

    for (let month = 1; month <= 12; month++) {
      if (selectedYear === currentYear && month > currentMonth) break;

      const monthlyRevenue = getRevenue(selectedYear, month);

      // RBT12 = last 12 months of conciliated revenue
      let rbt12 = 0;
      for (let i = 0; i < 12; i++) {
        let y = selectedYear;
        let m = month - i;
        if (m <= 0) { m += 12; y -= 1; }
        rbt12 += getRevenue(y, m);
      }

      const bracket = SIMPLES_NACIONAL_BRACKETS.find(b => rbt12 <= b.limit);
      let taxDue = 0;
      let effectiveRate = 0;

      if (bracket && rbt12 > 0 && monthlyRevenue > 0) {
        effectiveRate = Math.max(0, (rbt12 * bracket.rate - bracket.deduction) / rbt12);
        taxDue = monthlyRevenue * effectiveRate;
      }

      results.push({ month, revenue: monthlyRevenue, rbt12, effectiveRate, taxDue: Math.max(0, taxDue) });
    }

    return results;
  }, [allConciliatedDeposits, selectedYear]);

  const currentMonthSimples = useMemo(() => {
    if (selectedMonth === 0) {
      return {
        revenue: simplesData.reduce((s, d) => s + d.revenue, 0),
        rbt12: simplesData.length ? simplesData[simplesData.length - 1].rbt12 : 0,
        effectiveRate: 0,
        taxDue: simplesData.reduce((s, d) => s + d.taxDue, 0),
      };
    }
    return simplesData.find(d => d.month === selectedMonth) || { revenue: 0, rbt12: 0, effectiveRate: 0, taxDue: 0 };
  }, [simplesData, selectedMonth]);

  /* ── summary numbers for NFS-e tab ── */
  const conciliatedCount = depositsOfMonth.filter(d => d.isConciliated).length;
  const unconciliatedCount = depositsOfMonth.filter(d => !d.isConciliated).length;
  const conciliatedTotal = depositsOfMonth
    .filter(d => d.isConciliated)
    .reduce((s, d) => s + d.deposit.amount, 0);

  /* ── export ── */
  const handleExportExcel = () => {
    if (activeSection === 'nfse') {
      const data = filteredDeposits.map(d => ({
        'Data': formatDate(d.deposit.date),
        'Plataforma': d.platform,
        'Hóspede(s)': d.reservations.map(r => r.guestName).join(' + ') || '—',
        'Tomador': d.tomadorLabel,
        'CNPJ/CPF Tomador': d.tomadorCnpj,
        'Valor (R$)': d.deposit.amount,
        'Conciliado': d.isConciliated ? 'Sim' : 'Não',
      }));
      exportToExcel(`NFS-e_${getMonthName(selectedMonth)}_${selectedYear}`, data);
    } else {
      const data = simplesData.map(d => ({
        'Mês': getMonthName(d.month),
        'Receita (Depósitos Conciliados)': d.revenue,
        'RBT12': d.rbt12,
        'Alíquota Efetiva (%)': (d.effectiveRate * 100).toFixed(2),
        'DAS Devido': d.taxDue,
      }));
      exportToExcel(`Simples_Nacional_${selectedYear}`, data);
    }
  };

  /* ── render ── */
  const periodLabel =
    selectedMonth === 0
      ? `Exercício ${selectedYear}`
      : `${getMonthName(selectedMonth)} / ${selectedYear}`;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
            Fiscal · {periodLabel}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Depósitos conciliados = NFS-e emitidas no portal
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Excel
          </button>
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1 w-fit">
        {(['nfse', 'simples'] as const).map(s => (
          <button
            key={s}
            onClick={() => setActiveSection(s)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeSection === s
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {s === 'nfse' ? 'NFS-e (depósitos)' : 'Simples Nacional'}
          </button>
        ))}
      </div>

      {/* ══ NFS-e section ════════════════════════════════════════ */}
      {activeSection === 'nfse' && (
        <div className="space-y-4">

          {/* KPI strip */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                Conciliados (= emitidos)
              </p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {conciliatedCount}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {formatCurrency(conciliatedTotal)}
              </p>
            </div>

            <div className={`border rounded-xl p-4 ${
              unconciliatedCount > 0
                ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
            }`}>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                Não conciliados
              </p>
              <p className={`text-2xl font-bold ${
                unconciliatedCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200'
              }`}>
                {unconciliatedCount}
              </p>
              {unconciliatedCount > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Verificar conciliação
                </p>
              )}
            </div>

            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                Total do período
              </p>
              <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                {formatCurrency(depositsOfMonth.reduce((s, d) => s + d.deposit.amount, 0))}
              </p>
            </div>
          </div>

          {/* Explanation banner */}
          <div className="flex gap-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-4 text-sm text-blue-800 dark:text-blue-300">
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              Cada depósito conciliado corresponde a uma NFS-e já emitida no portal.
              Os dados abaixo (tomador, valor) são os que devem constar na nota emitida.
              Depósitos não conciliados não entram no Simples Nacional — verifique a conciliação.
            </span>
          </div>

          {/* Deposits table */}
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
                    <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400">Data</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400">Plataforma</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400">Hóspede(s)</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400">Tomador NFS-e</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-500 dark:text-slate-400">Valor</th>
                    <th className="px-4 py-3 text-center font-medium text-slate-500 dark:text-slate-400">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {filteredDeposits.map(d => (
                    <tr
                      key={d.deposit.id}
                      className={`transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/30 ${
                        !d.isConciliated ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''
                      }`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                        {formatDate(d.deposit.date)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          d.platform === 'AIRBNB'
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                            : d.platform === 'BOOKING'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            : d.platform === 'DECOLAR'
                            ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                        }`}>
                          {d.platform}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[220px]">
                        {d.isConciliated ? (
                          <span className="text-slate-700 dark:text-slate-300 truncate block" title={d.reservations.map(r => r.guestName).join(' + ')}>
                            {d.reservations.map(r => r.guestName).join(' + ')}
                          </span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            Sem reserva vinculada
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs max-w-[180px] truncate" title={d.tomadorLabel}>
                        {d.tomadorLabel}
                        {d.tomadorCnpj && (
                          <span className="block text-slate-400 dark:text-slate-500">{d.tomadorCnpj}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right font-medium text-slate-800 dark:text-slate-200">
                        {formatCurrency(d.deposit.amount)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {d.isConciliated ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            Emitida
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                            Pendente
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}

                  {filteredDeposits.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                        Nenhum depósito encontrado para o período.
                      </td>
                    </tr>
                  )}
                </tbody>

                {filteredDeposits.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
                      <td colSpan={4} className="px-4 py-3 text-sm font-medium text-slate-600 dark:text-slate-400">
                        {filteredDeposits.filter(d => d.isConciliated).length} conciliados ·{' '}
                        {filteredDeposits.filter(d => !d.isConciliated).length} pendentes
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-800 dark:text-slate-100">
                        {formatCurrency(filteredDeposits.reduce((s, d) => s + d.deposit.amount, 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══ Simples Nacional section ════════════════════════════ */}
      {activeSection === 'simples' && (
        <div className="space-y-4">

          {/* Month summary card */}
          {selectedMonth !== 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Receita do mês</p>
                <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{formatCurrency(currentMonthSimples.revenue)}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">depósitos conciliados</p>
              </div>
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">RBT12</p>
                <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{formatCurrency(currentMonthSimples.rbt12)}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">últimos 12 meses</p>
              </div>
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Alíquota efetiva</p>
                <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
                  {currentMonthSimples.revenue > 0
                    ? ((currentMonthSimples as any).effectiveRate !== undefined
                        ? ((currentMonthSimples as any).effectiveRate * 100).toFixed(2)
                        : '—')
                    : '—'}%
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Anexo III</p>
              </div>
              <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-xl p-4">
                <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400 uppercase tracking-wide mb-1">DAS devido</p>
                <p className="text-xl font-bold text-indigo-700 dark:text-indigo-300">{formatCurrency(currentMonthSimples.taxDue)}</p>
                <p className="text-xs text-indigo-500 dark:text-indigo-400 mt-1">a pagar</p>
              </div>
            </div>
          )}

          {/* Notice */}
          <div className="flex gap-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-sm text-slate-600 dark:text-slate-400">
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              Receita = depósitos bancários conciliados. RBT12 acumulado pelos últimos 12 meses.
              Alíquota efetiva calculada pelo Anexo III da LC 123/2006.
            </span>
          </div>

          {/* Annual table */}
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                Resumo anual — {selectedYear}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="px-4 py-2.5 text-left font-medium text-slate-500 dark:text-slate-400">Mês</th>
                    <th className="px-4 py-2.5 text-right font-medium text-slate-500 dark:text-slate-400">Receita</th>
                    <th className="px-4 py-2.5 text-right font-medium text-slate-500 dark:text-slate-400">RBT12</th>
                    <th className="px-4 py-2.5 text-right font-medium text-slate-500 dark:text-slate-400">Alíquota</th>
                    <th className="px-4 py-2.5 text-right font-medium text-slate-500 dark:text-slate-400">DAS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {simplesData.map(d => (
                    <tr
                      key={d.month}
                      className={`transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/30 ${
                        d.month === selectedMonth
                          ? 'bg-indigo-50 dark:bg-indigo-900/20'
                          : ''
                      }`}
                    >
                      <td className={`px-4 py-2.5 font-medium ${
                        d.month === selectedMonth
                          ? 'text-indigo-700 dark:text-indigo-300'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}>
                        {getMonthName(d.month)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-300">
                        {d.revenue > 0 ? formatCurrency(d.revenue) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">
                        {formatCurrency(d.rbt12)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">
                        {d.revenue > 0 ? `${(d.effectiveRate * 100).toFixed(2)}%` : '—'}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${
                        d.taxDue > 0
                          ? 'text-indigo-700 dark:text-indigo-300'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}>
                        {d.taxDue > 0 ? formatCurrency(d.taxDue) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40">
                    <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-300">Total</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-800 dark:text-slate-100">
                      {formatCurrency(simplesData.reduce((s, d) => s + d.revenue, 0))}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400">—</td>
                    <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400">—</td>
                    <td className="px-4 py-3 text-right font-bold text-indigo-700 dark:text-indigo-300">
                      {formatCurrency(simplesData.reduce((s, d) => s + d.taxDue, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FiscalReport;
