import React, { useState, useEffect } from 'react';

interface ManualDepositModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (depositRow: any[], month: number, year: number) => Promise<void>;
    selectedMonth: number;
    selectedYear: number;
    availableYears: number[];
}

const ManualDepositModal: React.FC<ManualDepositModalProps> = ({
    isOpen,
    onClose,
    onSave,
    selectedMonth,
    selectedYear,
    availableYears,
}) => {
    const [date, setDate] = useState('');
    const [amount, setAmount] = useState('');
    const [platform, setPlatform] = useState('Booking.com');
    const [description, setDescription] = useState('');
    const [month, setMonth] = useState(selectedMonth);
    const [year, setYear] = useState(selectedYear);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setDate('');
            setAmount('');
            setPlatform('Booking.com');
            setDescription('');
            setMonth(selectedMonth || new Date().getMonth() + 1);
            setYear(selectedYear || new Date().getFullYear());
            setIsSaving(false);
        }
    }, [isOpen, selectedMonth, selectedYear]);

    if (!isOpen) return null;

    const handleSave = async () => {
        if (!date || !amount || parseFloat(amount) <= 0 || !platform) {
            alert('Preencha os campos obrigatórios corretamente.');
            return;
        }

        let finalDescription = '';
        if (platform === 'Booking.com') {
            finalDescription = 'PIX BOOKING.COM';
        } else if (platform === 'Airbnb') {
            finalDescription = 'PIX AIRBNB';
        } else {
            finalDescription = description || 'Outro';
        }

        // Format date to DD/MM/YYYY
        // HTML date input is YYYY-MM-DD
        const dateParts = date.split('-');
        const formattedDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;

        const depositRow = [formattedDate, finalDescription, parseFloat(amount)];

        setIsSaving(true);
        try {
            await onSave(depositRow, month, year);
            onClose();
        } catch (error) {
            console.error('Failed to save deposit:', error);
            alert('Falha ao salvar o depósito');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-500/75 dark:bg-gray-900/80 transition-opacity" aria-modal="true">
            <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6 z-10">
                <div className="flex justify-between items-start mb-5">
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Lançar Depósito Manual</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            Adicione um depósito ao mês especificado sem precisar importar um arquivo.
                        </p>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="flex space-x-4">
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mês de Destino</label>
                            <select
                                value={month}
                                onChange={(e) => setMonth(Number(e.target.value))}
                                className="w-full border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                            >
                                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                                    <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleString('pt-BR', { month: 'long' })}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ano de Destino</label>
                            <select
                                value={year}
                                onChange={(e) => setYear(Number(e.target.value))}
                                className="w-full border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                            >
                                {availableYears.length > 0 ? availableYears.map(y => (
                                    <option key={y} value={y}>{y}</option>
                                )) : Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <hr className="border-t border-gray-200 dark:border-gray-700" />

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data do Depósito <span className="text-red-500">*</span></label>
                        <input
                            type="date"
                            required
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="w-full border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valor (R$) <span className="text-red-500">*</span></label>
                        <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            required
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0,00"
                            className="w-full border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Plataforma / Tipo <span className="text-red-500">*</span></label>
                        <select
                            value={platform}
                            onChange={(e) => setPlatform(e.target.value)}
                            className="w-full border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        >
                            <option value="Booking.com">Booking.com</option>
                            <option value="Airbnb">Airbnb</option>
                            <option value="Outro">Outro</option>
                        </select>
                    </div>

                    {platform === 'Outro' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição do depósito</label>
                            <input
                                type="text"
                                maxLength={100}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Ex: PIX VRBO, Transferência direto, etc."
                                className="w-full border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                            />
                        </div>
                    )}
                </div>

                <div className="mt-6 flex justify-end space-x-3">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSaving}
                        className="px-4 py-2 border border-gray-300 dark:border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={isSaving || !date || !amount || parseFloat(amount) <= 0 || !platform}
                        className="inline-flex justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                        {isSaving ? 'Salvando...' : 'Salvar depósito'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ManualDepositModal;
