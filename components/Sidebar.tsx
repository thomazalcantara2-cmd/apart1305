import React, { useState } from 'react';
import { ReportType } from '../types';

interface SidebarProps {
    activeReport: ReportType;
    setActiveReport: (report: ReportType) => void;
    isSidebarMinimized: boolean;
    setIsSidebarMinimized: (v: boolean) => void;
    isMobileSidebarOpen: boolean;
    setIsMobileSidebarOpen: (v: boolean) => void;
    onImportClick: () => void;
    onImportPdfClick: () => void;
    onManualDepositClick: () => void;
    isUploading: boolean;
    fontSize: number;
}

const Icon: React.FC<{ d: string; size?: number }> = ({ d, size = 15 }) => (
    <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5}
        viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"
        style={{ flexShrink: 0, minWidth: size, minHeight: size }}>
        <path d={d} />
    </svg>
);

const Divider = () => (
    <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '4px 0' }} />
);

const SectionLabel: React.FC<{ label: string; minimized: boolean; scale: number }> = ({ label, minimized, scale }) =>
    minimized ? <Divider /> : (
        <div style={{
            fontSize: 10 * scale, fontWeight: 700, letterSpacing: '0.08em',
            color: 'rgba(255,255,255,0.32)', padding: `${10 * scale}px ${16 * scale}px ${4 * scale}px`,
            textTransform: 'uppercase' as const,
        }}>{label}</div>
    );

const SubGroupLabel: React.FC<{ label: string; scale: number }> = ({ label, scale }) => (
    <div style={{
        fontSize: 11 * scale, fontWeight: 600, letterSpacing: '0.06em',
        color: 'rgba(255,255,255,0.26)', padding: `${8 * scale}px ${16 * scale}px ${2 * scale}px`,
        textTransform: 'uppercase' as const,
    }}>{label}</div>
);

interface NavItemProps {
    label: string;
    iconPath: string;
    active: boolean;
    onClick: () => void;
    minimized: boolean;
    sub?: boolean;
    scale: number;
}

const NavItem: React.FC<NavItemProps> = ({ label, iconPath, active, onClick, minimized, sub = false, scale }) => {
    const [hovered, setHovered] = useState(false);
    return (
        <button
            onClick={onClick}
            title={minimized ? label : ''}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10 * scale,
                width: '100%',
                padding: sub && !minimized ? `${6 * scale}px ${16 * scale}px ${6 * scale}px ${36 * scale}px` : `${7 * scale}px ${16 * scale}px`,
                background: active ? 'rgba(255,255,255,0.1)' : hovered ? 'rgba(255,255,255,0.05)' : 'transparent',
                borderLeft: active ? `${2 * scale}px solid #CDA45E` : `${2 * scale}px solid transparent`,
                color: active ? '#fff' : 'rgba(255,255,255,0.58)',
                fontSize: (sub ? 13 : 14) * scale,
                fontWeight: active ? 600 : 400,
                textAlign: 'left' as const,
                cursor: 'pointer',
                transition: 'background 0.1s',
                whiteSpace: 'nowrap' as const,
                overflow: 'hidden',
                justifyContent: minimized ? 'center' as const : 'flex-start' as const,
                fontFamily: 'inherit',
            }}
        >
            <span style={{ color: active ? (sub ? '#CDA45E' : '#fff') : 'rgba(255,255,255,0.45)', display: 'flex', flexShrink: 0 }}>
                <Icon d={iconPath} size={(sub ? 13 : 15) * scale} />
            </span>
            {!minimized && label}
        </button>
    );
};

const ICONS = {
    dashboard:    'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    calendar:     'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0h18',
    reception:    'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
    laundry:      'M21 12a9 9 0 11-18 0 9 9 0 0118 0zM12 8v4m0 4h.01',
    expense:      'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z',
    monthly:      'M13 7h8m0 0v8m0-8L11 17l-4-4-6 6',
    annual:       'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zm6.75-4.5c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zm6.75-4.5c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
    costs:        'M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3',
    caixa:        'M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9',
    conciliation: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    discount:     'M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244',
    fiscal:       'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
    ia:           'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z',
    chevL:        'M11 19l-7-7 7-7m8 14l-7-7 7-7',
    chevR:        'M13 5l7 7-7 7M5 5l7 7-7 7',
    close:        'M6 18L18 6M6 6l12 12',
};

const Sidebar: React.FC<SidebarProps> = ({
    activeReport, setActiveReport,
    isSidebarMinimized, setIsSidebarMinimized,
    isMobileSidebarOpen, setIsMobileSidebarOpen,
    fontSize,
}) => {
    const go = (r: ReportType) => {
        setActiveReport(r);
        if (window.innerWidth < 1024) setIsMobileSidebarOpen(false);
    };
    const m = isSidebarMinimized;
    const fiscalActive = activeReport === ReportType.CarneLeao || activeReport === ReportType.NfseControl;
    const scale = fontSize / 100;

    return (
        <>
            {isMobileSidebarOpen && (
                <div
                    onClick={() => setIsMobileSidebarOpen(false)}
                    style={{ position: 'fixed', inset: 0, zIndex: 20, background: 'rgba(0,0,0,0.5)' }}
                    className="lg:hidden"
                />
            )}

            <aside
                className={`fixed inset-y-0 left-0 z-30 lg:static lg:translate-x-0 ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:flex flex-col`}
                style={{
                    width: 240 * scale,
                    background: '#1e2433',
                    flexShrink: 0,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                {/* Logo bar */}
                <div style={{
                    height: 56 * scale, display: 'flex', alignItems: 'center',
                    justifyContent: m ? 'center' : 'space-between',
                    padding: `0 ${14 * scale}px`,
                    borderBottom: '1px solid rgba(255,255,255,0.07)',
                    flexShrink: 0, gap: 8 * scale,
                }}>
                    {!m && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 * scale, overflow: 'hidden', flex: 1 }}>
                            <div style={{
                                width: 28 * scale, height: 28 * scale, background: '#fff', borderRadius: 6 * scale,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                            }}>
                                <svg width={14 * scale} height={14 * scale} viewBox="0 0 16 16" fill="#1e2433">
                                    <path d="M8 1L10 6H15L11 9L12.5 14L8 11L3.5 14L5 9L1 6H6Z" />
                                </svg>
                            </div>
                            <div style={{ overflow: 'hidden' }}>
                                <div style={{ fontSize: 13 * scale, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>Gestão Flats</div>
                                <div style={{ fontSize: 10 * scale, color: 'rgba(255,255,255,0.38)' }}>Porto Prime · Di Maré</div>
                            </div>
                        </div>
                    )}
                    <button
                        onClick={() => setIsMobileSidebarOpen(false)}
                        className="lg:hidden"
                        style={{ padding: 5, color: 'rgba(255,255,255,0.45)', cursor: 'pointer' }}
                    >
                        <Icon d={ICONS.close} size={15} />
                    </button>
                </div>

                {/* Nav items */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>

                    <SectionLabel label="Operacional" minimized={false} scale={scale} />
                    <NavItem label="Dashboard"              iconPath={ICONS.dashboard}    active={activeReport === ReportType.Dashboard}                  onClick={() => go(ReportType.Dashboard)}               minimized={false} scale={scale} />
                    <NavItem label="Calendário de Reservas" iconPath={ICONS.calendar}     active={activeReport === ReportType.Calendar}                   onClick={() => go(ReportType.Calendar)}                minimized={false} scale={scale} />
                    <NavItem label="Recepção / Faxina"      iconPath={ICONS.reception}    active={activeReport === ReportType.ReceptionCleaning}          onClick={() => go(ReportType.ReceptionCleaning)}       minimized={false} scale={scale} />
                    <NavItem label="Lavanderia"             iconPath={ICONS.laundry}      active={activeReport === ReportType.LaundryControl}            onClick={() => go(ReportType.LaundryControl)}          minimized={false} scale={scale} />

                    <Divider />

                    <SectionLabel label="Financeiro" minimized={false} scale={scale} />
                    <NavItem label="Lançamento de Despesas" iconPath={ICONS.expense}      active={activeReport === ReportType.ExpenseEntry}               onClick={() => go(ReportType.ExpenseEntry)}            minimized={false} scale={scale} />

                    <SubGroupLabel label="Regime de Competência" scale={scale} />
                    <NavItem label="Relatório Mensal"        iconPath={ICONS.monthly}     active={activeReport === ReportType.Financial}                  onClick={() => go(ReportType.Financial)}               minimized={false} sub scale={scale} />
                    <NavItem label="Relatório Anual"         iconPath={ICONS.annual}      active={activeReport === ReportType.YearlyFinancialSummary}     onClick={() => go(ReportType.YearlyFinancialSummary)}  minimized={false} sub scale={scale} />
                    <NavItem label="Comparativo de Custos"   iconPath={ICONS.costs}       active={activeReport === ReportType.FixedCosts}                 onClick={() => go(ReportType.FixedCosts)}              minimized={false} sub scale={scale} />

                    <SubGroupLabel label="Regime de Caixa" scale={scale} />
                    <NavItem label="Relatório Mensal"        iconPath={ICONS.monthly}     active={activeReport === ReportType.CashFlow}                   onClick={() => go(ReportType.CashFlow)}                minimized={false} sub scale={scale} />
                    <NavItem label="Relatório Anual"         iconPath={ICONS.annual}      active={activeReport === ReportType.YearlyCashFlow}             onClick={() => go(ReportType.YearlyCashFlow)}          minimized={false} sub scale={scale} />
                    <NavItem label="Competência × Caixa"     iconPath={ICONS.conciliation} active={activeReport === ReportType.CashAccrualCompare}        onClick={() => go(ReportType.CashAccrualCompare)}      minimized={false} sub scale={scale} />
                    <NavItem label="Histórico de conciliação" iconPath={ICONS.conciliation} active={activeReport === ReportType.Compensation}             onClick={() => go(ReportType.Compensation)}            minimized={false} sub scale={scale} />
                    <NavItem label="Conciliação manual"      iconPath={ICONS.discount}    active={activeReport === ReportType.InteractiveCompensation}    onClick={() => go(ReportType.InteractiveCompensation)} minimized={false} sub scale={scale} />

                    <Divider />

                    <SectionLabel label="Fiscal" minimized={false} scale={scale} />
                    <NavItem label="NFS-e / Simples Nacional" iconPath={ICONS.fiscal}     active={fiscalActive}                                          onClick={() => go(ReportType.CarneLeao)}               minimized={false} scale={scale} />

                    <Divider />

                    <SectionLabel label="Sugestões IA" minimized={false} scale={scale} />
                    <NavItem label="Otimização de Preços"    iconPath={ICONS.ia}          active={activeReport === ReportType.DynamicPricing}            onClick={() => go(ReportType.DynamicPricing)}          minimized={false} scale={scale} />
                </div>
            </aside>
        </>
    );
};

export default Sidebar;
