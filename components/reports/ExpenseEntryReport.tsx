
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { UnifiedData, FinancialData } from '../../types';
import { formatCurrency, getMonthName } from '../../utils/helpers';
import { saveConfigData } from '../../services/dataService';
import { CONDOMINIO_201_FIXED, CONDOMINIO_202_FIXED } from '../../constants';

interface Props {
    unifiedData: UnifiedData;
    selectedYear: number;
    selectedMonth: number;
    onDataSave: (key: string, data: FinancialData) => void;
}

const ExpenseInput: React.FC<{label?: string, value: number, onChange: (v: number) => void, readOnly?: boolean, className?: string}> = ({label, value, onChange, readOnly = false, className}) => {
    const [localValue, setLocalValue] = useState<string | null>(null);
    const [prevValue, setPrevValue] = useState(value);

    if (value !== prevValue) {
        setPrevValue(value);
        setLocalValue(null);
    }

    const isEditing = localValue !== null;

    const handleFocus = () => {
        setLocalValue(value ? String(value).replace('.', ',') : '');
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setLocalValue(e.target.value);
    };

    const handleBlur = () => {
        if (localValue !== null) {
            const sanitized = localValue.replace(/[^\d,]/g, '');
            const numericValue = parseFloat(sanitized.replace(',', '.')) || 0;
            onChange(numericValue);
        }
        setLocalValue(null);
    };
    
    return (
        <div className={className}>
            {label && <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>}
            <input 
                type="text"
                inputMode={readOnly ? undefined : "decimal"}
                value={isEditing ? (localValue || '') : formatCurrency(value)}
                onFocus={!readOnly ? handleFocus : undefined}
                onChange={!readOnly ? handleChange : undefined}
                onBlur={!readOnly ? handleBlur : undefined}
                readOnly={readOnly}
                className={`mt-1 block w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-right ${readOnly ? 'bg-slate-100 dark:bg-slate-700 cursor-not-allowed' : 'bg-white dark:bg-slate-700'}`}
             />
        </div>
    );
};

const ExpenseEntryReport: React.FC<Props> = ({ unifiedData, selectedYear, selectedMonth, onDataSave }) => {
    const [selectedFlats, setSelectedFlats] = useState<string[]>(['201', '202']);
    const [isSaving, setIsSaving] = useState(false);
    const [customExpenseLocalValues, setCustomExpenseLocalValues] = useState<Record<string, string>>({});

    const viewType = useMemo(() => {
        const sorted = [...selectedFlats].sort().join(',');
        if (sorted === '201,202') return '201_202';
        if (sorted === '301') return '301';
        return 'invalid';
    }, [selectedFlats]);

    const getInitialState = useCallback((): FinancialData => {
        let configKey: string | null = null;
        let defaultConfig: FinancialData;

        if (viewType === '201_202') {
            configKey = `financialConfig-${selectedYear}-${selectedMonth}`;
            defaultConfig = {
                deductibleExpenses: {
                    condominio: CONDOMINIO_201_FIXED, taxaExtra: 0, energia: 0, iptu: 0,
                    condominio202: CONDOMINIO_202_FIXED, taxaExtra202: 0, energia202: 0, iptu202: 0
                },
                otherExpenses: { mensalidadeStays: 250 },
                customExpenses: [],
            };
        } else if (viewType === '301') {
            configKey = `financialConfig301-${selectedYear}-${selectedMonth}`;
            defaultConfig = {
                deductibleExpenses: { condominio: 0, taxaExtra: 0, energia: 0, iptu: 0 },
                otherExpenses: { mensalidadeStays: 250 },
                customExpenses: [],
            };
        } else {
            return { deductibleExpenses: {}, otherExpenses: {}, customExpenses: [] };
        }
        
        const savedData = unifiedData[configKey] as FinancialData;
        
        if (savedData) {
            const merged = { 
                ...defaultConfig, 
                ...savedData,
                deductibleExpenses: { ...defaultConfig.deductibleExpenses, ...(savedData.deductibleExpenses || {}) },
                otherExpenses: { ...defaultConfig.otherExpenses, ...(savedData.otherExpenses || {}) }
            };
            // Restore defaults if missing even in saved data (migration safety)
            if (viewType === '201_202') {
                if(!merged.deductibleExpenses.condominio) merged.deductibleExpenses.condominio = CONDOMINIO_201_FIXED;
                if(!merged.deductibleExpenses.condominio202) merged.deductibleExpenses.condominio202 = CONDOMINIO_202_FIXED;
                if(!merged.otherExpenses.mensalidadeStays) merged.otherExpenses.mensalidadeStays = 250;
            }
            if (viewType === '301') {
                if(!merged.otherExpenses.mensalidadeStays) merged.otherExpenses.mensalidadeStays = 250;
            }
            return merged;
        }
        return defaultConfig;
    }, [unifiedData, selectedYear, selectedMonth, viewType]);

    const [formData, setFormData] = useState<FinancialData>(getInitialState);

    useEffect(() => {
        setFormData(getInitialState());
    }, [getInitialState, selectedYear, selectedMonth]); // Refresh when period or view changes

    const handleInputChange = (type: 'deductibleExpenses' | 'otherExpenses', key: string, value: number) => {
        setFormData(prev => ({ ...prev, [type]: { ...prev[type], [key]: value } }));
    };

    const handleCustomExpenseChange = (id: string, field: 'description' | 'value', value: string | number) => {
        setFormData(prev => ({
            ...prev,
            customExpenses: prev.customExpenses.map(exp => exp.id === id ? { ...exp, [field]: value } : exp)
        }));
    };

    const addCustomExpense = () => {
        setFormData(prev => ({
            ...prev,
            customExpenses: [...prev.customExpenses, { id: Date.now().toString(), description: '', value: 0 }]
        }));
    };

    const removeCustomExpense = (id: string) => {
        setFormData(prev => ({
            ...prev,
            customExpenses: prev.customExpenses.filter(exp => exp.id !== id)
        }));
    };

    const handleSave = async () => {
        if (viewType === 'invalid') return;
        setIsSaving(true);
        const dataType = viewType === '301' ? 'financialConfig301' : 'financialConfig';
        const currentConfigKey = viewType === '301' 
            ? `financialConfig301-${selectedYear}-${selectedMonth}`
            : `financialConfig-${selectedYear}-${selectedMonth}`;
        try {
            await saveConfigData(dataType, currentConfigKey, formData);
            onDataSave(currentConfigKey, formData);
            alert('Despesas salvas com sucesso!');
        } catch (error) {
            console.error("Failed to save financial data:", error);
            alert(`Erro ao salvar os dados: ${error}`);
        } finally {
            setIsSaving(false);
        }
    };

    const handleFlatToggle = (option: '201_202' | '301') => {
        if (option === '201_202') setSelectedFlats(['201', '202']);
        else setSelectedFlats(['301']);
    };

    return (
        <div className="space-y-6">
            <div className="card p-6">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-6">
                    <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-slate-700 dark:text-slate-200">LANÇAMENTO DE DESPESAS DO MÊS - {getMonthName(selectedMonth).toUpperCase()}/{selectedYear}</h2>
                    </div>
                    <div className="flex bg-slate-100 dark:bg-slate-700 p-1 rounded-lg">
                        <button
                            onClick={() => handleFlatToggle('201_202')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${viewType === '201_202' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-white shadow' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
                        >
                            Flats 201 & 202
                        </button>
                        <button
                            onClick={() => handleFlatToggle('301')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${viewType === '301' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-white shadow' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
                        >
                            Flat 301
                        </button>
                    </div>
                </div>

                {viewType !== 'invalid' ? (
                    <div className="max-w-4xl mx-auto">
                        <div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200">Preencha os valores abaixo:</h3>
                                <button onClick={handleSave} disabled={isSaving} className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:bg-blue-300 transition-colors shadow-sm">
                                    {isSaving ? 'Salvando...' : 'Salvar Alterações'}
                                </button>
                            </div>

                            <div className="overflow-x-auto mb-8">
                                {viewType === '201_202' && (
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b-2 border-slate-200 dark:border-slate-700">
                                                <th className="text-left py-3 text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider">Despesas dos Flats</th>
                                                <th className="text-right py-3 px-2 text-slate-600 dark:text-slate-300 font-bold w-32 uppercase tracking-wider">Flat 201</th>
                                                <th className="text-right py-3 px-2 text-slate-600 dark:text-slate-300 font-bold w-32 uppercase tracking-wider">Flat 202</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                            <tr>
                                                <td className="py-3 text-slate-700 dark:text-slate-200">Condomínio (Fixo)</td>
                                                <td className="py-2 px-1"><ExpenseInput value={formData.deductibleExpenses.condominio} onChange={(v) => handleInputChange('deductibleExpenses', 'condominio', v)} readOnly={true} /></td>
                                                <td className="py-2 px-1"><ExpenseInput value={formData.deductibleExpenses.condominio202} onChange={(v) => handleInputChange('deductibleExpenses', 'condominio202', v)} readOnly={true} /></td>
                                            </tr>
                                            <tr>
                                                <td className="py-3 text-slate-700 dark:text-slate-200">Taxa Extra</td>
                                                <td className="py-2 px-1"><ExpenseInput value={formData.deductibleExpenses.taxaExtra} onChange={(v) => handleInputChange('deductibleExpenses', 'taxaExtra', v)} /></td>
                                                <td className="py-2 px-1"><ExpenseInput value={formData.deductibleExpenses.taxaExtra202} onChange={(v) => handleInputChange('deductibleExpenses', 'taxaExtra202', v)} /></td>
                                            </tr>
                                            <tr>
                                                <td className="py-3 text-slate-700 dark:text-slate-200">Energia</td>
                                                <td className="py-2 px-1"><ExpenseInput value={formData.deductibleExpenses.energia} onChange={(v) => handleInputChange('deductibleExpenses', 'energia', v)} /></td>
                                                <td className="py-2 px-1"><ExpenseInput value={formData.deductibleExpenses.energia202} onChange={(v) => handleInputChange('deductibleExpenses', 'energia202', v)} /></td>
                                            </tr>
                                            <tr>
                                                <td className="py-3 text-slate-700 dark:text-slate-200">IPTU</td>
                                                <td className="py-2 px-1"><ExpenseInput value={formData.deductibleExpenses.iptu} onChange={(v) => handleInputChange('deductibleExpenses', 'iptu', v)} /></td>
                                                <td className="py-2 px-1"><ExpenseInput value={formData.deductibleExpenses.iptu202} onChange={(v) => handleInputChange('deductibleExpenses', 'iptu202', v)} /></td>
                                            </tr>
                                        </tbody>
                                    </table>
                                )}

                                {viewType === '301' && (
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b-2 border-slate-200 dark:border-slate-700">
                                                <th className="text-left py-3 text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider">Despesas Flat 301</th>
                                                <th className="text-right py-3 px-2 text-slate-600 dark:text-slate-300 font-bold w-40 uppercase tracking-wider">Valor</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                            <tr>
                                                <td className="py-3 text-slate-700 dark:text-slate-200">Condomínio</td>
                                                <td className="py-2 px-1"><ExpenseInput value={formData.deductibleExpenses.condominio} onChange={(v) => handleInputChange('deductibleExpenses', 'condominio', v)} /></td>
                                            </tr>
                                            <tr>
                                                <td className="py-3 text-slate-700 dark:text-slate-200">Taxa Extra</td>
                                                <td className="py-2 px-1"><ExpenseInput value={formData.deductibleExpenses.taxaExtra} onChange={(v) => handleInputChange('deductibleExpenses', 'taxaExtra', v)} /></td>
                                            </tr>
                                            <tr>
                                                <td className="py-3 text-slate-700 dark:text-slate-200">Energia</td>
                                                <td className="py-2 px-1"><ExpenseInput value={formData.deductibleExpenses.energia} onChange={(v) => handleInputChange('deductibleExpenses', 'energia', v)} /></td>
                                            </tr>
                                            <tr>
                                                <td className="py-3 text-slate-700 dark:text-slate-200">IPTU</td>
                                                <td className="py-2 px-1"><ExpenseInput value={formData.deductibleExpenses.iptu} onChange={(v) => handleInputChange('deductibleExpenses', 'iptu', v)} /></td>
                                            </tr>
                                        </tbody>
                                    </table>
                                )}
                            </div>

                            <div className="overflow-x-auto mb-8">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b-2 border-slate-200 dark:border-slate-700">
                                             <th className="text-left py-3 text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider">Outras Despesas</th>
                                             <th className="text-right py-3 px-2 text-slate-600 dark:text-slate-300 font-bold w-40 uppercase tracking-wider">Valor</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td className="py-3 text-slate-700 dark:text-slate-200">Mensalidade Stays (Sistemas)</td>
                                            <td className="py-2 px-1"><ExpenseInput value={formData.otherExpenses.mensalidadeStays} onChange={(v) => handleInputChange('otherExpenses', 'mensalidadeStays', v)} readOnly={true} /></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
                                <h4 className="text-md font-bold text-slate-700 dark:text-slate-200 mb-4 uppercase tracking-wider">Despesas Customizadas (Obras, Reparos, etc)</h4>
                                <div className="space-y-2">
                                    {formData.customExpenses.map((exp) => {
                                        const isEditing = customExpenseLocalValues[exp.id] !== undefined;
                                        const displayValue = isEditing
                                            ? customExpenseLocalValues[exp.id]
                                            : formatCurrency(exp.value);

                                        return (
                                            <div key={exp.id} className="flex flex-col sm:flex-row items-center gap-2 p-2 bg-white dark:bg-slate-700 rounded shadow-sm border border-slate-200 dark:border-slate-600">
                                                <input 
                                                    type="text" 
                                                    placeholder="Descrição da despesa" 
                                                    value={exp.description} 
                                                    onChange={e => handleCustomExpenseChange(exp.id, 'description', e.target.value)} 
                                                    className="flex-grow w-full sm:w-auto px-3 py-2 border border-slate-300 dark:border-slate-600 rounded text-sm bg-transparent" 
                                                />
                                                <div className="flex items-center gap-2 w-full sm:w-auto">
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        placeholder="Valor"
                                                        value={displayValue}
                                                        onFocus={() => {
                                                            setCustomExpenseLocalValues(prev => ({ ...prev, [exp.id]: exp.value ? String(exp.value).replace('.', ',') : '' }));
                                                        }}
                                                        onChange={e => {
                                                            setCustomExpenseLocalValues(prev => ({ ...prev, [exp.id]: e.target.value }));
                                                        }}
                                                        onBlur={() => {
                                                            const localVal = customExpenseLocalValues[exp.id];
                                                            if (localVal !== undefined) {
                                                                const sanitized = localVal.replace(/[^\d,]/g, '');
                                                                const numericValue = parseFloat(sanitized.replace(',', '.')) || 0;
                                                                handleCustomExpenseChange(exp.id, 'value', numericValue);
                                                            }
                                                            setCustomExpenseLocalValues(prev => {
                                                                const newState = { ...prev };
                                                                delete newState[exp.id];
                                                                return newState;
                                                            });
                                                        }}
                                                        className="w-full sm:w-32 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded text-right text-sm bg-transparent"
                                                    />
                                                    <button onClick={() => removeCustomExpense(exp.id)} className="text-red-500 p-2 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-full transition-colors" title="Remover">&times;</button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <button onClick={addCustomExpense} className="mt-4 text-sm bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-4 py-2 rounded hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors font-medium">
                                    + Adicionar Nova Despesa
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-10 text-slate-500">Selecione uma opção acima para lançar as despesas.</div>
                )}
            </div>
        </div>
    );
};

export default ExpenseEntryReport;
