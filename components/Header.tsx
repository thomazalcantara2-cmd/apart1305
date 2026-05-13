import React, { useState, useRef, useEffect } from 'react';
import { ReportType } from '../types';

interface HeaderProps {
    searchTerm: string;
    setSearchTerm: (term: string) => void;
    onMenuClick: () => void;
    availableYears: number[];
    selectedYear: number;
    setSelectedYear: (year: number) => void;
    selectedMonth: number;
    setSelectedMonth: (month: number) => void;
    theme: 'light' | 'dark';
    toggleTheme: () => void;
    fontSize: number;
    setFontSize: (size: number | ((prev: number) => number)) => void;
    activeReport?: ReportType;
    onImportClick: () => void;
    onImportPdfClick: () => void;
    onManualDepositClick: () => void;
    isUploading: boolean;
}

const PAGE_TITLES: Partial<Record<ReportType, string>> = {
    [ReportType.Dashboard]:                 'Dashboard',
    [ReportType.Calendar]:                  'Calendário de Reservas',
    [ReportType.ReceptionCleaning]:         'Recepção / Faxina',
    [ReportType.LaundryControl]:            'Lavanderia',
    [ReportType.ExpenseEntry]:              'Lançamento de Despesas',
    [ReportType.Financial]:                 'Relatório Mensal — Regime de Competência',
    [ReportType.YearlyFinancialSummary]:    'Relatório Anual — Regime de Competência',
    [ReportType.FixedCosts]:               'Comparativo de Custos',
    [ReportType.CashFlow]:                 'Relatório Mensal — Regime de Caixa',
    [ReportType.YearlyCashFlow]:           'Relatório Anual — Regime de Caixa',
    [ReportType.Compensation]:             'Histórico de conciliação',
    [ReportType.InteractiveCompensation]:  'Conciliação manual',
    [ReportType.CarneLeao]:               'Fiscal — NFS-e / Simples Nacional',
    [ReportType.NfseControl]:             'Fiscal — NFS-e / Simples Nacional',
    [ReportType.DynamicPricing]:          'Otimização de Preços',
};

const months = [
    { value: 0, label: 'Ano inteiro' },
    { value: 1, label: 'Janeiro' }, { value: 2, label: 'Fevereiro' },
    { value: 3, label: 'Março' },   { value: 4, label: 'Abril' },
    { value: 5, label: 'Maio' },    { value: 6, label: 'Junho' },
    { value: 7, label: 'Julho' },   { value: 8, label: 'Agosto' },
    { value: 9, label: 'Setembro' },{ value: 10, label: 'Outubro' },
    { value: 11, label: 'Novembro' },{ value: 12, label: 'Dezembro' },
];

const Header: React.FC<HeaderProps> = ({
    searchTerm, setSearchTerm, onMenuClick,
    availableYears, selectedYear, setSelectedYear,
    selectedMonth, setSelectedMonth,
    theme, toggleTheme, fontSize, setFontSize,
    activeReport,
    onImportClick, onImportPdfClick, onManualDepositClick,
    isUploading,
}) => {
    const [importOpen, setImportOpen] = useState(false);
    const importRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (importRef.current && !importRef.current.contains(e.target as Node)) setImportOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const pageTitle = activeReport ? (PAGE_TITLES[activeReport] ?? 'Gestão Flats') : 'Gestão Flats';

    const selectCls = "block pl-3 pr-8 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition-colors";
    const iconBtnCls = "p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-none transition-colors";

    return (
        <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 z-10 flex-shrink-0">
            <div className="flex items-center gap-3 px-4 h-14">

                {/* Mobile hamburger */}
                <button onClick={onMenuClick} className={`${iconBtnCls} lg:hidden`}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                </button>

                {/* Page title */}
                <span className="hidden sm:block text-sm font-semibold text-slate-800 dark:text-slate-100 tracking-wide uppercase mr-auto truncate">
                    {pageTitle}
                </span>
                <span className="sm:hidden mr-auto" />

                {/* Period selectors */}
                <div className="flex items-center gap-1.5">
                    <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))} className={selectCls}>
                        {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                    <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} className={selectCls}>
                        {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                </div>

                {/* Search */}
                <div className="hidden sm:flex items-center gap-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-md px-3 py-1.5 w-44 focus-within:ring-1 focus-within:ring-slate-400 transition-all">
                    <svg className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                        placeholder="Hóspede, flat..."
                        className="flex-1 bg-transparent text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none min-w-0"
                    />
                </div>

                {/* + Importar dropdown */}
                <div className="relative" ref={importRef}>
                    <button
                        onClick={() => setImportOpen(v => !v)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-slate-800 dark:bg-slate-600 text-white rounded-md hover:bg-slate-700 dark:hover:bg-slate-500 transition-colors focus:outline-none"
                    >
                        {isUploading ? (
                            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                            </svg>
                        ) : (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m-8-8h16" />
                            </svg>
                        )}
                        <span className="hidden sm:inline">Importar</span>
                        <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>

                    {importOpen && (
                        <div className="absolute right-0 top-10 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 w-52 z-50">
                            <button
                                onClick={() => { onImportClick(); setImportOpen(false); }}
                                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-left"
                            >
                                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                                Planilha de reservas
                            </button>
                            <button
                                onClick={() => { onImportPdfClick(); setImportOpen(false); }}
                                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-left"
                            >
                                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                                </svg>
                                Extrato PDF / Excel
                            </button>
                            <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                            <button
                                onClick={() => { onManualDepositClick(); setImportOpen(false); }}
                                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-left"
                            >
                                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                                </svg>
                                Depósito manual
                            </button>
                        </div>
                    )}
                </div>

                {/* Theme toggle */}
                <button onClick={toggleTheme} className={iconBtnCls} title={theme === 'light' ? 'Modo escuro' : 'Modo claro'}>
                    {theme === 'light' ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                        </svg>
                    ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                    )}
                </button>

                {/* Font Size Controls */}
                <div className="flex items-center bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-md overflow-hidden">
                    <button 
                        onClick={() => setFontSize(prev => Math.max(50, prev - 10))} 
                        className="px-2 py-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors focus:outline-none" 
                        title="Diminuir fonte"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
                    </button>
                    <button 
                        onClick={() => setFontSize(100)} 
                        className="px-2 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors focus:outline-none border-x border-slate-200 dark:border-slate-600" 
                        title="Restaurar tamanho original"
                    >
                        {fontSize}%
                    </button>
                    <button 
                        onClick={() => setFontSize(prev => Math.min(200, prev + 10))} 
                        className="px-2 py-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors focus:outline-none" 
                        title="Aumentar fonte"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    </button>
                </div>
            </div>

            {/* Mobile search */}
            <div className="sm:hidden px-4 pb-3">
                <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-md px-3 py-1.5">
                    <svg className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                        placeholder="Hóspede, flat..."
                        className="flex-1 bg-transparent text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none" />
                </div>
            </div>
        </header>
    );
};

export default Header;
