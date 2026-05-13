
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Reservation, UnifiedData, ReceptionData, LinenChange, CleaningData, LaundryEntry } from '../../types';
import { formatDate, exportToExcel, formatCurrency, getMonthName, sanitizePdfText } from '../../utils/helpers';
import { saveConfigData } from '../../services/dataService';

// Declare introJs to avoid TypeScript errors since it's loaded from a CDN
declare const introJs: any;

interface Props {
    reservations: Reservation[];
    unifiedData: UnifiedData;
    selectedYear: number;
    selectedMonth: number;
    searchTerm: string;
    onDataSave: (key: string, data: any) => void;
}

type ViewMode = 'standard' | 'timeline' | 'agenda';

interface TimelineEvent {
    id: string;
    date: Date;
    type: 'Check-in' | 'Check-out' | 'Troca de Enxoval';
    reservation: Reservation;
    details?: string;
    status?: 'pending' | 'confirmed' | 'declined';
}

const ReceptionCleaningReport: React.FC<Props> = ({ reservations, unifiedData, selectedYear, selectedMonth, searchTerm, onDataSave }) => {
    const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
    const [selectedFlat, setSelectedFlat] = useState<string>('all');
    const [showDetails, setShowDetails] = useState<boolean>(false);
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [startTour, setStartTour] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('standard');
    const [isSaving, setIsSaving] = useState(false);

    // Load saved linen changes
    const configKey = `receptionConfig-${selectedYear}-${selectedMonth}`;
    
    // Initialize state with saved data or empty object
    const [receptionData, setReceptionData] = useState<ReceptionData>(() => {
        const saved = unifiedData[configKey] as ReceptionData;
        return saved || { linenChanges: {} };
    });

    // Update local state when unifiedData changes (e.g. after fresh load)
    useEffect(() => {
        const saved = unifiedData[configKey] as ReceptionData;
        if (saved) {
            setReceptionData(saved);
        } else {
            setReceptionData({ linenChanges: {} });
        }
    }, [unifiedData, configKey]);

     useEffect(() => {
        if (startTour) {
            const intro = introJs();
            intro.setOptions({
                steps: [
                    {
                        element: '[data-tour-reception="title"]',
                        title: 'Relatório de Recepção/Faxina 🧹',
                        intro: 'Este relatório é ideal para a equipe de <strong>recepção e limpeza</strong>. Ele lista todas as chegadas, saídas e trocas de enxoval do mês.',
                        position: 'bottom'
                    },
                    {
                        element: '[data-tour-reception="view-toggle"]',
                        title: 'Modos de Visualização 👁️',
                        intro: 'Alterne entre a <strong>Visão Padrão</strong> (Tabela), <strong>Linha do Tempo</strong> (Lista) e a nova <strong>Agenda Diária</strong> (Calendário Visual).',
                        position: 'bottom'
                    },
                    {
                        element: '[data-tour-reception="linen-calc"]',
                        title: 'Trocas de Enxoval 🧺',
                        intro: 'O sistema calcula automaticamente trocas de enxoval a cada 5 dias. Você pode ver e editar essas datas expandindo a reserva.',
                        position: 'left'
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
    
    const availablePlatforms = useMemo(() => {
        const platforms = new Set(reservations.map(r => r.platform));
        return ['all', ...Array.from(platforms).sort()];
    }, [reservations]);

    const availableFlats = useMemo(() => {
        const flats = new Set(reservations.map(r => r.flat));
        return ['all', ...Array.from(flats).sort()];
    }, [reservations]);

    // Helper to calculate default linen change dates (every 6 days: 5 days stay + 1)
    const calculateDefaultLinenChanges = (checkIn: Date, checkOut: Date): LinenChange[] => {
        const changes: LinenChange[] = [];
        const currentDate = new Date(checkIn);
        currentDate.setDate(currentDate.getDate() + 5); // Add 5 days

        while (currentDate < checkOut) {
            changes.push({
                date: currentDate.toISOString().split('T')[0],
                status: 'pending'
            });
            currentDate.setDate(currentDate.getDate() + 5);
        }
        return changes;
    };

    const filteredAndMergedData = useMemo(() => {
        let filtered = reservations.filter(r => {
            const checkInInPeriod = r.checkIn.getUTCFullYear() === selectedYear && r.checkIn.getUTCMonth() + 1 === selectedMonth;
            const checkOutInPeriod = r.checkOut.getUTCFullYear() === selectedYear && r.checkOut.getUTCMonth() + 1 === selectedMonth;
            const spansMonth = r.checkIn < new Date(Date.UTC(selectedYear, selectedMonth - 1, 1)) && r.checkOut > new Date(Date.UTC(selectedYear, selectedMonth, 0));
            
            return checkInInPeriod || checkOutInPeriod || spansMonth;
        });

        if (selectedPlatform !== 'all') {
            filtered = filtered.filter(r => r.platform === selectedPlatform);
        }

        if (selectedFlat !== 'all') {
            filtered = filtered.filter(r => r.flat === selectedFlat);
        }
        
        filtered = filtered.sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime());

        if (searchTerm) {
            const lowercasedFilter = searchTerm.toLowerCase();
            return filtered.filter(item =>
                Object.values(item).some(val =>
                    String(val).toLowerCase().includes(lowercasedFilter)
                )
            );
        }

        return filtered;
    }, [reservations, selectedYear, selectedMonth, searchTerm, selectedPlatform, selectedFlat]);

    // Helper to get effective linen changes for a reservation (saved or default)
    const getEffectiveLinenChanges = useCallback((res: Reservation): LinenChange[] => {
        // If saved data exists and is an array (legacy check) and not empty
        if (receptionData.linenChanges[res.id] && Array.isArray(receptionData.linenChanges[res.id])) {
            const saved = receptionData.linenChanges[res.id];
            // Backward compatibility: if array of strings, convert to objects
            if (saved.length > 0 && typeof saved[0] === 'string') {
                return (saved as any as string[]).map(d => ({ date: d, status: 'pending' }));
            }
            return saved;
        }
        return calculateDefaultLinenChanges(res.checkIn, res.checkOut);
    }, [receptionData.linenChanges]);

    const timelineEvents = useMemo(() => {
        const events: TimelineEvent[] = [];
        const monthStart = new Date(Date.UTC(selectedYear, selectedMonth - 1, 1));
        const monthEnd = new Date(Date.UTC(selectedYear, selectedMonth, 0, 23, 59, 59));

        filteredAndMergedData.forEach(res => {
            if (res.checkIn >= monthStart && res.checkIn <= monthEnd) {
                events.push({ id: `in-${res.id}`, date: res.checkIn, type: 'Check-in', reservation: res });
            }
            if (res.checkOut >= monthStart && res.checkOut <= monthEnd) {
                events.push({ id: `out-${res.id}`, date: res.checkOut, type: 'Check-out', reservation: res });
            }
            
            const changes = getEffectiveLinenChanges(res);

            changes.forEach((change, idx) => {
                const date = new Date(change.date);
                if (date >= monthStart && date <= monthEnd) {
                    events.push({ 
                        id: `linen-${res.id}-${idx}`, 
                        date: date, 
                        type: 'Troca de Enxoval', 
                        reservation: res,
                        details: `Troca ${idx + 1} (${change.status === 'confirmed' ? 'Confirmado' : change.status === 'declined' ? 'Recusado' : 'Pendente'})`,
                        status: change.status
                    });
                }
            });
        });

        return events.sort((a, b) => a.date.getTime() - b.date.getTime());
    }, [filteredAndMergedData, selectedYear, selectedMonth, getEffectiveLinenChanges]);

    // Group events by Day for Agenda View
    const agendaDays = useMemo(() => {
        const daysMap = new Map<string, { date: Date, events: TimelineEvent[], hasTurnover: Record<string, boolean> }>();
        
        // Ensure we cover all days in month if needed for calendar, but map logic is fine
        // as we will iterate calendar days and lookup from map
        timelineEvents.forEach(event => {
            if (!event) return;
            const dateKey = event.date.toISOString().split('T')[0];
            if (!daysMap.has(dateKey)) {
                daysMap.set(dateKey, { date: event.date, events: [], hasTurnover: {} });
            }
            const dayData = daysMap.get(dateKey)!;
            dayData.events.push(event);
        });

        // Detect Turnovers (Check-in AND Check-out for same flat on same day)
        daysMap.forEach(dayData => {
            if (!dayData || !dayData.events) return;
            const checkIns = new Set(dayData.events.filter(e => e && e.type === 'Check-in').map(e => e.reservation.flat));
            const checkOuts = new Set(dayData.events.filter(e => e && e.type === 'Check-out').map(e => e.reservation.flat));
            
            checkIns.forEach(flat => {
                if (checkOuts.has(flat)) {
                    dayData.hasTurnover[flat] = true;
                }
            });
        });

        return daysMap;
    }, [timelineEvents]);

    const handleWhatsAppShare = (date: Date, events: TimelineEvent[], turnovers: Record<string, boolean>) => {
        const dateStr = date.toLocaleDateString('pt-BR');
        let text = `📅 *AGENDA DE LIMPEZA - ${dateStr}*\n\n`;

        const checkOuts = events.filter(e => e.type === 'Check-out');
        const checkIns = events.filter(e => e.type === 'Check-in');
        const linens = events.filter(e => e.type === 'Troca de Enxoval' && e.status !== 'declined');

        if (checkOuts.length > 0) {
            text += `🛑 *SAÍDAS*\n`;
            checkOuts.forEach(e => {
                const isTurnover = turnovers[e.reservation.flat];
                text += `- Flat ${e.reservation.flat}: ${e.reservation.guestName} ${isTurnover ? '⚠️ *VIRADA*' : ''}\n`;
            });
            text += `\n`;
        }

        if (linens.length > 0) {
            text += `🧺 *TROCAS DE ENXOVAL*\n`;
            linens.forEach(e => {
                text += `- Flat ${e.reservation.flat}: ${e.reservation.guestName}\n`;
            });
            text += `\n`;
        }

        if (checkIns.length > 0) {
            text += `✅ *ENTRADAS*\n`;
            checkIns.forEach(e => {
                const isTurnover = turnovers[e.reservation.flat];
                text += `- Flat ${e.reservation.flat}: ${e.reservation.guestName} ${isTurnover ? '⚠️ *PRIORIDADE*' : ''}\n`;
            });
        }

        if (checkOuts.length === 0 && checkIns.length === 0 && linens.length === 0) {
            text += `Sem atividades programadas.\n`;
        }

        const encodedText = encodeURIComponent(text);
        window.open(`https://wa.me/?text=${encodedText}`, '_blank');
    };

    const handleLinenDateChange = (resId: string, index: number, newDateStr: string) => {
        const res = filteredAndMergedData.find(r => r.id === resId);
        if (!res) return;

        const currentChanges = getEffectiveLinenChanges(res);
        
        if (newDateStr) {
            currentChanges[index] = { ...currentChanges[index], date: newDateStr };
        }

        currentChanges.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        
        setReceptionData(prev => ({
            ...prev,
            linenChanges: { ...prev.linenChanges, [resId]: currentChanges }
        }));
    };

    const handleStatusChange = (resId: string, index: number, newStatus: 'pending' | 'confirmed' | 'declined') => {
        const res = filteredAndMergedData.find(r => r.id === resId);
        if (!res) return;

        const currentChanges = getEffectiveLinenChanges(res);
        currentChanges[index] = { ...currentChanges[index], status: newStatus };

        setReceptionData(prev => ({
            ...prev,
            linenChanges: { ...prev.linenChanges, [resId]: currentChanges }
        }));
    };

    const handleAddLinenDate = (resId: string) => {
        const res = filteredAndMergedData.find(r => r.id === resId);
        if (!res) return;

        const currentChanges = getEffectiveLinenChanges(res);

        const lastDateStr = currentChanges.length > 0 ? currentChanges[currentChanges.length - 1].date : res.checkIn.toISOString().split('T')[0];
        const newDate = new Date(lastDateStr);
        newDate.setDate(newDate.getDate() + 1);
        
        if (newDate >= res.checkOut) {
            newDate.setDate(res.checkOut.getDate() - 1);
        }

        currentChanges.push({ date: newDate.toISOString().split('T')[0], status: 'pending' });
        currentChanges.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        setReceptionData(prev => ({
            ...prev,
            linenChanges: { ...prev.linenChanges, [resId]: currentChanges }
        }));
    };

    const handleRemoveLinenDate = (resId: string, index: number) => {
        const res = filteredAndMergedData.find(r => r.id === resId);
        if (!res) return;

        const currentChanges = getEffectiveLinenChanges(res);
        currentChanges.splice(index, 1);

        setReceptionData(prev => ({
            ...prev,
            linenChanges: { ...prev.linenChanges, [resId]: currentChanges }
        }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // 1. Save Reception Data
            await saveConfigData('cleaningConfig', configKey, receptionData as any);
            onDataSave(configKey, receptionData);

            // 2. Sync with Laundry Control
            const cleaningKey = `cleaningConfig-${selectedYear}-${selectedMonth}`;
            let cleaningData = unifiedData[cleaningKey] as CleaningData;
            
            if (!cleaningData) {
                cleaningData = { laundryEntries: {}, newAdvance: 0, serviceDeduction: 0, finalDebt: 0 };
            }

            const updatedEntries = { ...cleaningData.laundryEntries };
            
            filteredAndMergedData.forEach(res => {
                const changes = getEffectiveLinenChanges(res);
                const confirmedCount = changes.filter(c => c.status === 'confirmed').length;
                
                // Get or create existing entry. If creating, assume default values.
                const existingEntry = updatedEntries[res.id] || { 
                    laundryQty: res.flat === '202' ? 15 : 25, 
                    hasExtraCleaning: false, 
                    extraCleaningQty: 0, 
                    hasExtraLaundry: false, 
                    extraLaundryQty: 0 
                };

                const defaultLaundryPerChange = res.flat === '202' ? 15 : 25;

                // Update entry directly. If confirmedCount is 0, extras will be disabled/zeroed.
                updatedEntries[res.id] = {
                    ...existingEntry,
                    hasExtraCleaning: confirmedCount > 0,
                    extraCleaningQty: confirmedCount,
                    hasExtraLaundry: confirmedCount > 0,
                    extraLaundryQty: confirmedCount * defaultLaundryPerChange
                };
            });

            const updatedCleaningData = { ...cleaningData, laundryEntries: updatedEntries };
            
            await saveConfigData('cleaningConfig', cleaningKey, updatedCleaningData);
            onDataSave(cleaningKey, updatedCleaningData);

            alert('Dados salvos e sincronizados com Controle de Lavanderia!');
        } catch (error) {
            console.error("Failed to save reception data:", error);
            alert("Erro ao salvar dados.");
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleExportPdf = () => {
        const doc = new (window as any).jspdf.jsPDF();
        const monthName = getMonthName(selectedMonth).toUpperCase();
        
        if (viewMode === 'agenda') {
            // ADVANCED CALENDAR GRID MODE FOR AGENDA
            const title = `AGENDA DE LIMPEZA - ${monthName}/${selectedYear}`;
            doc.text(title, 14, 16);
            
            // Prepare Calendar Matrix with rich data for manual drawing
            const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
            const firstDayOfWeek = new Date(selectedYear, selectedMonth - 1, 1).getDay(); // 0 = Sunday
            
            const weeks = [];
            let currentWeek: any[] = new Array(7).fill(null);
            
            // Fill actual days
            for (let day = 1; day <= daysInMonth; day++) {
                const dow = (firstDayOfWeek + day - 1) % 7;
                
                // Collect events for this day
                const dateKey = new Date(Date.UTC(selectedYear, selectedMonth - 1, day)).toISOString().split('T')[0];
                const dayData = agendaDays.get(dateKey);
                
                const eventsList: { text: string, color: [number, number, number] }[] = [];
                let isTurnoverDay = false;

                if (dayData) {
                    const checkOuts = dayData.events.filter(e => e && e.type === 'Check-out');
                    const linens = dayData.events.filter(e => e && e.type === 'Troca de Enxoval' && e.status !== 'declined');
                    const checkIns = dayData.events.filter(e => e && e.type === 'Check-in');

                    // SAÍDAS (Check-outs) - RED
                    checkOuts.forEach(e => {
                        if (dayData.hasTurnover[e.reservation.flat]) isTurnoverDay = true;
                        const guestFirstName = sanitizePdfText(e.reservation.guestName.split(' ')[0]);
                        eventsList.push({ text: `<< Check-out: ${guestFirstName} (${e.reservation.flat})`, color: [220, 38, 38] });
                    });
                    
                    // TROCAS - BLUE
                    linens.forEach(e => {
                        const guestFirstName = sanitizePdfText(e.reservation.guestName.split(' ')[0]);
                        eventsList.push({ text: `(T) Troca: ${guestFirstName} (${e.reservation.flat})`, color: [37, 99, 235] });
                    });

                    // ENTRADAS (Check-ins) - GREEN
                    checkIns.forEach(e => {
                        if (dayData.hasTurnover[e.reservation.flat]) isTurnoverDay = true;
                        const guestFirstName = sanitizePdfText(e.reservation.guestName.split(' ')[0]);
                        eventsList.push({ text: `>> Check-in: ${guestFirstName} (${e.reservation.flat})`, color: [22, 163, 74] });
                    });
                }

                currentWeek[dow] = {
                    dayNumber: String(day),
                    events: eventsList,
                    isTurnover: isTurnoverDay
                };

                // End of week?
                if (dow === 6 || day === daysInMonth) {
                    weeks.push([...currentWeek]);
                    currentWeek = new Array(7).fill(null); // Reset for next row
                }
            }

            (doc as any).autoTable({
                startY: 20,
                head: [["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"]],
                body: weeks,
                theme: 'grid',
                styles: { fontSize: 8, valign: 'top', cellPadding: 1, minCellHeight: 25 },
                headStyles: { fillColor: [44, 62, 80], halign: 'center' },
                didParseCell: function(data: any) {
                    // Pre-styling for background colors
                    if (data.section === 'body') {
                        const cellData = data.cell.raw;
                        if (cellData && cellData.isTurnover) {
                            data.cell.styles.fillColor = [255, 237, 213]; // Light Orange for turnover
                        } else if (!cellData) {
                            data.cell.styles.fillColor = [248, 250, 252]; // Empty days
                        }
                        
                        // IMPORTANT: Clear default text to manually draw later
                        data.cell.text = []; 
                    }
                },
                didDrawCell: function(data: any) {
                    if (data.section === 'body' && data.cell.raw) {
                        const cellData = data.cell.raw;
                        const x = data.cell.x + 2;
                        let y = data.cell.y + 4;

                        // Draw Day Number
                        doc.setFontSize(8);
                        doc.setTextColor(50, 50, 50);
                        doc.setFont("helvetica", "bold");
                        doc.text(cellData.dayNumber, x, y);
                        y += 4;

                        // Draw Events Line by Line with custom colors
                        doc.setFontSize(6);
                        doc.setFont("helvetica", "normal");
                        
                        cellData.events.forEach((evt: any) => {
                            doc.setTextColor(evt.color[0], evt.color[1], evt.color[2]);
                            // Check for overflow? For now assume it fits or simple crop
                            doc.text(evt.text, x, y);
                            y += 3;
                        });
                    }
                }
            });

            // Add Legend
            const finalY = (doc as any).autoTable.previous.finalY + 10;
            doc.setFontSize(8);
            doc.setTextColor(0,0,0);
            doc.text("Legenda:", 14, finalY);
            doc.setTextColor(220, 38, 38); doc.text("<< Saída", 30, finalY);
            doc.setTextColor(22, 163, 74); doc.text(">> Entrada", 50, finalY);
            doc.setTextColor(37, 99, 235); doc.text("(T) Troca", 70, finalY);
            doc.setFillColor(255, 237, 213); doc.rect(90, finalY - 3, 4, 4, "F");
            doc.setTextColor(0,0,0); doc.text("Virada (In/Out mesmo dia)", 96, finalY);

            doc.save(`Agenda_Limpeza_${monthName}_${selectedYear}.pdf`);

        } else if (viewMode === 'standard') {
            // STANDARD TABLE PDF (ENHANCED WITH LINEN ROWS)
            const title = `RELATÓRIO DE RECEPÇÃO (PADRÃO) - ${monthName}/${selectedYear}`;
            doc.text(title, 14, 16);

            // Flatten data: include linen changes as separate rows sorted chronologically
            const pdfRows: any[] = [];

            filteredAndMergedData.forEach(res => {
                const changes = getEffectiveLinenChanges(res);
                const confirmedChanges = changes.filter(c => c.status === 'confirmed'); // Filter: Only CONFIRMED linen changes appear in PDF
                
                // Main Reservation Row
                // Standard: Only date, no extra symbol
                const checkOutText = formatDate(res.checkOut);

                pdfRows.push({
                    type: 'reservation',
                    dateSort: res.checkIn,
                    data: [
                        res.flat,
                        sanitizePdfText(res.guestName),
                        res.platform,
                        formatDate(res.checkIn),
                        checkOutText
                    ],
                    originalRes: res
                });

                // Linen Change Rows
                confirmedChanges.forEach(change => {
                    const changeDate = new Date(change.date);
                    pdfRows.push({
                        type: 'linen',
                        dateSort: changeDate,
                        data: [
                            res.flat,
                            sanitizePdfText(res.guestName),
                            res.platform,
                            formatDate(changeDate),
                            "TROCA ENXOVAL"
                        ],
                        originalRes: res
                    });
                });
            });

            // Sort by Date (interleave linen changes)
            pdfRows.sort((a, b) => a.dateSort.getTime() - b.dateSort.getTime());

            // 5 Columns now (Trocas column removed)
            const headers = [["FLAT", "HÓSPEDE", "PLATAFORMA", "DATA/CHECK-IN", "CHECK-OUT/DETALHE"]];
            const body = pdfRows.map(r => r.data);

            (doc as any).autoTable({
                startY: 20,
                head: headers,
                body: body,
                theme: 'grid',
                styles: { fontSize: 8 },
                headStyles: { fillColor: [41, 128, 185] },
                didParseCell: function(data: any) {
                    if (data.section === 'body') {
                        const rowData = pdfRows[data.row.index];
                        
                        // Highlight Linen Change Rows (Blue)
                        if (rowData.type === 'linen') {
                            data.cell.styles.fillColor = [224, 242, 254]; // Light Blue
                            data.cell.styles.textColor = [30, 64, 175]; // Dark Blue
                            data.cell.styles.fontStyle = 'bold';
                        } 
                        // Standard Reservation Rows Logic
                        else {
                            const originalRes = rowData.originalRes;
                            // Highlight rows spanning across months (Red Background)
                            if (originalRes.checkIn.getUTCMonth() !== originalRes.checkOut.getUTCMonth()) {
                                data.cell.styles.fillColor = [254, 202, 202]; // Light red
                            }
                        }
                    }
                }
            });
            
            doc.save(`Recepcao_Padrao_${monthName}_${selectedYear}.pdf`);

        } else {
            // TIMELINE MODE - Visual Card Style
            const title = `LINHA DO TEMPO - ${monthName}/${selectedYear}`;
            doc.text(title, 14, 16);
        
            const headers = [["DATA", "TIPO / HÓSPEDE / FLAT", "DETALHES"]];
            const body = timelineEvents.map(e => [
                // Col 1: Date formatted
                `${formatDate(e.date)}\n${e.date.toLocaleDateString('pt-BR', { weekday: 'short' }).toUpperCase()}`,
                
                // Col 2: Content
                // Note: We'll style this column heavily in didParseCell/didDrawCell
                `${e.type.toUpperCase()} - FLAT ${e.reservation.flat}\n${sanitizePdfText(e.reservation.guestName)}`,
                
                // Col 3: Details
                sanitizePdfText(e.details) || '-'
            ]);
        
            (doc as any).autoTable({
                startY: 20,
                head: headers,
                body: body,
                theme: 'grid',
                styles: { fontSize: 10, valign: 'middle', cellPadding: 2 },
                headStyles: { fillColor: [44, 62, 80] },
                columnStyles: {
                    0: { cellWidth: 18, fontStyle: 'bold', halign: 'center' }, // Reduced width for Date square
                    1: { cellWidth: 100 },
                    2: { cellWidth: 'auto' }
                },
                didParseCell: function (data: any) {
                    if (data.section === 'body') {
                        const originalEvent = timelineEvents[data.row.index];
                        if (!originalEvent) return; 
                        
                        // Apply Background Colors based on Type
                        if (originalEvent.type === 'Check-in') {
                            data.cell.styles.fillColor = [240, 253, 244]; // Green-50
                            if (data.column.index === 1) data.cell.styles.textColor = [22, 101, 52]; // Green-800
                        } else if (originalEvent.type === 'Check-out') {
                            data.cell.styles.fillColor = [254, 242, 242]; // Red-50
                            if (data.column.index === 1) data.cell.styles.textColor = [153, 27, 27]; // Red-800
                        } else if (originalEvent.type === 'Troca de Enxoval') {
                            data.cell.styles.fillColor = [239, 246, 255]; // Blue-50
                            if (data.column.index === 1) data.cell.styles.textColor = [30, 64, 175]; // Blue-800
                        }
                    }
                },
                didDrawCell: function (data: any) {
                    // Draw Colored Left Border for Card Effect
                    if (data.section === 'body' && data.column.index === 0) {
                        const originalEvent = timelineEvents[data.row.index];
                        if (!originalEvent) return;

                        let stripeColor: [number, number, number] = [200, 200, 200];
                        
                        if (originalEvent.type === 'Check-in') stripeColor = [34, 197, 94]; // Green
                        else if (originalEvent.type === 'Check-out') stripeColor = [239, 68, 68]; // Red
                        else if (originalEvent.type === 'Troca de Enxoval') stripeColor = [59, 130, 246]; // Blue

                        const doc = data.doc;
                        doc.setFillColor(stripeColor[0], stripeColor[1], stripeColor[2]);
                        // Draw a 2px wide strip on the left of the row
                        doc.rect(data.cell.x, data.cell.y, 2, data.cell.height, 'F');
                    }
                }
            });
            
            doc.save(`Recepcao_Timeline_${monthName}_${selectedYear}.pdf`);
        }
    };

    const handleExportExcel = () => {
        const data = timelineEvents.map(e => ({
            DATA: formatDate(e.date),
            TIPO: e.type,
            HÓSPEDE: e.reservation.guestName,
            FLAT: e.reservation.flat,
            DETALHES: e.details || ''
        }));
        exportToExcel(`Recepcao_Timeline_${selectedYear}_${selectedMonth}`, data);
    };

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

    const totalColumns = 6 + (showDetails ? 1 : 0);

    // Prepare Calendar Grid Data for Agenda View
    const calendarGrid = useMemo(() => {
        if (viewMode !== 'agenda') return [];
        const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
        const firstDayOfWeek = new Date(selectedYear, selectedMonth - 1, 1).getDay(); // 0 = Sunday
        const weeks = [];
        let currentWeek = [];

        // Padding empty days
        for (let i = 0; i < firstDayOfWeek; i++) {
            currentWeek.push(null);
        }

        // Days
        for (let day = 1; day <= daysInMonth; day++) {
            currentWeek.push(day);
            if (currentWeek.length === 7) {
                weeks.push(currentWeek);
                currentWeek = [];
            }
        }

        // Final padding
        if (currentWeek.length > 0) {
            while (currentWeek.length < 7) currentWeek.push(null);
            weeks.push(currentWeek);
        }
        
        return weeks;
    }, [viewMode, selectedYear, selectedMonth]);

    return (
        <div className="card p-6">
            <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-4">
                <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold text-slate-700 dark:text-slate-200" data-tour-reception="title">RELATÓRIO DE RECEPÇÃO/FAXINA</h2>
                    <button onClick={() => setStartTour(true)} className="bg-blue-100 text-blue-700 p-2 rounded-full hover:bg-blue-200 transition-colors dark:bg-slate-700 dark:text-blue-300 dark:hover:bg-slate-600">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </button>
                </div>
                
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 flex-wrap">
                    {/* View Toggle */}
                    <div className="bg-slate-100 dark:bg-slate-700 p-1 rounded-lg flex" data-tour-reception="view-toggle">
                        <button 
                            onClick={() => setViewMode('standard')}
                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'standard' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
                        >
                            Visão Padrão
                        </button>
                        <button 
                            onClick={() => setViewMode('timeline')}
                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'timeline' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
                        >
                            Linha do Tempo
                        </button>
                        <button 
                            onClick={() => setViewMode('agenda')}
                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'agenda' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
                        >
                            Agenda Diária
                        </button>
                    </div>

                    <div className="flex items-center">
                        <select
                            value={selectedFlat}
                            onChange={(e) => setSelectedFlat(e.target.value)}
                            className="border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-slate-700"
                        >
                            {availableFlats.map(flat => (
                                <option key={flat} value={flat}>{flat === 'all' ? 'Todos Flats' : `Flat ${flat}`}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex items-center space-x-2">
                        {viewMode === 'standard' && (
                            <button onClick={() => setShowDetails(!showDetails)} className="bg-slate-200 text-slate-700 px-4 py-2 rounded-md hover:bg-slate-300 text-sm dark:bg-slate-600 dark:text-slate-200">
                                {showDetails ? 'Ocultar $ ' : 'Ver $'}
                            </button>
                        )}
                        <button onClick={handleSave} disabled={isSaving} className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm disabled:opacity-50">
                            {isSaving ? 'Salvando...' : 'Salvar Alterações'}
                        </button>
                        <button onClick={handleExportPdf} className="bg-red-500 text-white p-2 rounded-md hover:bg-red-600">
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        </button>
                    </div>
                </div>
            </div>

            {viewMode === 'standard' ? (
                // STANDARD TABLE VIEW
                <div className="overflow-x-auto">
                    <table className="min-w-full no-zebra">
                        <thead>
                            <tr>
                                <th className="py-2 px-2 w-12 text-center"></th>
                                <th>FLAT</th>
                                <th>HÓSPEDE</th>
                                <th>CHECK-IN</th>
                                <th>CHECK-OUT</th>
                                <th className="text-center">TROCAS</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredAndMergedData.length > 0 ? filteredAndMergedData.map(res => {
                                const crossesMonths = res.checkIn.getUTCMonth() !== res.checkOut.getUTCMonth();
                                const isExpanded = expandedRows.has(res.id);
                                const linenChanges = getEffectiveLinenChanges(res);
                                const confirmedCount = linenChanges.filter(c => c.status === 'confirmed').length;

                                return (
                                    <React.Fragment key={res.id}>
                                        <tr className={`${crossesMonths ? 'bg-red-50 dark:bg-red-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}>
                                            <td className="py-2 px-2 text-center">
                                                <button onClick={() => handleToggleExpand(res.id)} className="text-blue-500 hover:text-blue-700 font-mono text-lg font-bold">
                                                    {isExpanded ? '−' : '+'}
                                                </button>
                                            </td>
                                            <td className="font-medium">{res.flat}</td>
                                            <td>
                                                <div className="font-semibold">{res.guestName}</div>
                                                <div className="text-xs text-slate-500">{res.platform}</div>
                                            </td>
                                            <td>{formatDate(res.checkIn)}</td>
                                            <td>{formatDate(res.checkOut)}</td>
                                            <td className="text-center" data-tour-reception="linen-calc">
                                                {linenChanges.length > 0 ? (
                                                    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded flex items-center justify-center gap-1 mx-auto w-fit ${confirmedCount > 0 ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4z" /><path fillRule="evenodd" d="M3 8h14v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm5 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" clipRule="evenodd" /></svg>
                                                        {confirmedCount}/{linenChanges.length}
                                                    </span>
                                                ) : <span className="text-slate-400">-</span>}
                                            </td>
                                        </tr>
                                        {isExpanded && (
                                            <tr>
                                                <td colSpan={totalColumns} className="p-0">
                                                    <div className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 pl-12 flex flex-col md:flex-row gap-6">
                                                        
                                                        {/* Linen Change Editor */}
                                                        <div className="flex-1 bg-white dark:bg-slate-700 p-4 rounded shadow-sm border border-yellow-200 dark:border-yellow-900/50">
                                                            <h4 className="font-bold text-yellow-700 dark:text-yellow-400 mb-3 flex items-center gap-2">
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" /><path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm9.707 5.707a1 1 0 00-1.414-1.414L9 12.586l-1.293-1.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                                                                Planejamento de Troca de Enxoval
                                                            </h4>
                                                            {linenChanges.length === 0 ? (
                                                                <p className="text-sm text-slate-500 mb-2">Nenhuma troca prevista (estadia curta).</p>
                                                            ) : (
                                                                <div className="space-y-3">
                                                                    {linenChanges.map((change, idx) => (
                                                                        <div key={idx} className={`flex items-center gap-2 p-2 rounded ${change.status === 'declined' ? 'opacity-60 bg-gray-100 dark:bg-slate-800' : ''}`}>
                                                                            <span className="text-sm font-medium text-slate-600 dark:text-slate-300 w-16">Troca {idx + 1}:</span>
                                                                            <input 
                                                                                type="date" 
                                                                                value={change.date}
                                                                                onChange={(e) => handleLinenDateChange(res.id, idx, e.target.value)}
                                                                                className={`border rounded px-2 py-1 text-sm dark:bg-slate-600 dark:border-slate-500 ${change.status === 'declined' ? 'line-through text-slate-400' : ''}`}
                                                                                disabled={change.status !== 'pending'}
                                                                            />
                                                                            
                                                                            {/* Status Actions */}
                                                                            <div className="flex items-center gap-1 ml-2">
                                                                                <button 
                                                                                    onClick={() => handleStatusChange(res.id, idx, 'confirmed')}
                                                                                    className={`p-1 rounded transition-colors ${change.status === 'confirmed' ? 'bg-green-500 text-white' : 'text-slate-400 hover:text-green-500 hover:bg-green-50'}`}
                                                                                    title="Confirmar troca"
                                                                                >
                                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                                                                </button>
                                                                                <button 
                                                                                    onClick={() => handleStatusChange(res.id, idx, 'declined')}
                                                                                    className={`p-1 rounded transition-colors ${change.status === 'declined' ? 'bg-red-500 text-white' : 'text-slate-400 hover:text-red-500 hover:bg-red-50'}`}
                                                                                    title="Hóspede recusou"
                                                                                >
                                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                                                                                </button>
                                                                                {change.status !== 'pending' && (
                                                                                    <button 
                                                                                        onClick={() => handleStatusChange(res.id, idx, 'pending')}
                                                                                        className="text-xs text-blue-500 hover:underline ml-2"
                                                                                    >
                                                                                        Resetar
                                                                                    </button>
                                                                                )}
                                                                            </div>

                                                                            <button onClick={() => handleRemoveLinenDate(res.id, idx)} className="text-slate-400 hover:text-red-500 ml-auto" title="Excluir data">&times;</button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            <button onClick={() => handleAddLinenDate(res.id)} className="mt-3 text-xs text-blue-600 hover:underline flex items-center gap-1">
                                                                <span className="text-lg font-bold">+</span> Adicionar data de troca
                                                            </button>
                                                        </div>

                                                        {/* Financial Details (Optional) */}
                                                        {showDetails && (
                                                            <div className="flex-1 bg-white dark:bg-slate-700 p-4 rounded shadow-sm border border-blue-200 dark:border-blue-900/50">
                                                                <h4 className="font-bold text-slate-700 dark:text-slate-200 mb-2">Detalhes Financeiros</h4>
                                                                <ul className="text-sm space-y-1 text-slate-600 dark:text-slate-300">
                                                                    <li>Ganhos Brutos: {formatCurrency(res.grossEarnings)}</li>
                                                                    <li>Taxas: {formatCurrency(res.fees)}</li>
                                                                    <li className="font-bold text-green-600 dark:text-green-400">Líquido: {formatCurrency(res.netEarnings)}</li>
                                                                </ul>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            }) : (
                                <tr>
                                    <td colSpan={totalColumns} className="py-4 px-4 text-center text-slate-500">Nenhuma reserva encontrada.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            ) : viewMode === 'timeline' ? (
                // TIMELINE VIEW
                <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
                    {timelineEvents.map((event, index) => (
                        <div 
                            key={`${event.id}-${index}`} 
                            className={`
                                flex items-center p-4 rounded-lg shadow-sm border-l-4 transition-all hover:shadow-md
                                ${event.type === 'Check-in' ? 'bg-green-50 border-green-500 dark:bg-green-900/10' : ''}
                                ${event.type === 'Check-out' ? 'bg-red-50 border-red-500 dark:bg-red-900/10' : ''}
                                ${event.type === 'Troca de Enxoval' ? (event.status === 'confirmed' ? 'bg-blue-50 border-blue-600' : event.status === 'declined' ? 'bg-gray-100 border-gray-400 opacity-60' : 'bg-blue-50 border-blue-500 dark:bg-blue-900/10') : ''}
                            `}
                        >
                            {/* Date Badge */}
                            <div className="flex flex-col items-center justify-center w-16 h-16 bg-white dark:bg-slate-800 rounded shadow-sm mr-4 flex-shrink-0">
                                <span className="text-xs text-slate-500 uppercase font-bold">{event.date.toLocaleDateString('pt-BR', { month: 'short' })}</span>
                                <span className="text-2xl font-bold text-slate-800 dark:text-slate-200">{event.date.getDate()}</span>
                                <span className="text-[10px] text-slate-400 uppercase">{event.date.toLocaleDateString('pt-BR', { weekday: 'short' })}</span>
                            </div>

                            {/* Content */}
                            <div className="flex-grow">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase
                                        ${event.type === 'Check-in' ? 'bg-green-200 text-green-800' : ''}
                                        ${event.type === 'Check-out' ? 'bg-red-200 text-red-800' : ''}
                                        ${event.type === 'Troca de Enxoval' ? 'bg-blue-200 text-blue-800' : ''}
                                    `}>
                                        {event.type}
                                    </span>
                                    <span className="text-sm text-slate-500 dark:text-slate-400 font-semibold">Flat {event.reservation.flat}</span>
                                </div>
                                <h3 className={`text-lg font-bold text-slate-800 dark:text-slate-100 ${event.status === 'declined' ? 'line-through' : ''}`}>{event.reservation.guestName}</h3>
                                {event.details && <p className="text-sm text-slate-600 italic">{event.details}</p>}
                            </div>

                            {/* Icon */}
                            <div className="text-slate-300 dark:text-slate-600">
                                {event.type === 'Check-in' && <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg>}
                                {event.type === 'Check-out' && <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>}
                                {event.type === 'Troca de Enxoval' && <svg className="w-8 h-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>}
                            </div>
                        </div>
                    ))}
                    {timelineEvents.length === 0 && <p className="text-center text-slate-500 py-8">Nenhum evento neste período.</p>}
                </div>
            ) : (
                // AGENDA DIÁRIA (Visual Calendar Grid)
                <div className="overflow-x-auto overflow-y-hidden">
                    <div className="min-w-[800px] border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                        {/* Header Row */}
                        <div className="grid grid-cols-7 bg-slate-800 text-white text-center text-xs font-bold py-2">
                            <div>DOM</div><div>SEG</div><div>TER</div><div>QUA</div><div>QUI</div><div>SEX</div><div>SÁB</div>
                        </div>
                        
                        {/* Grid Rows */}
                        {calendarGrid.map((week, weekIdx) => (
                            <div key={weekIdx} className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-700 last:border-0">
                                {week.map((day, dayIdx) => {
                                    if (!day) return <div key={dayIdx} className="bg-slate-50 dark:bg-slate-900/50 border-r border-slate-100 dark:border-slate-800/50"></div>;
                                    
                                    const dateKey = new Date(Date.UTC(selectedYear, selectedMonth - 1, day)).toISOString().split('T')[0];
                                    const dayData = agendaDays.get(dateKey);
                                    const isTurnover = dayData ? Object.values(dayData.hasTurnover).some(v => v) : false;

                                    return (
                                        <div key={dayIdx} className={`min-h-[120px] p-2 border-r border-slate-200 dark:border-slate-700 relative ${isTurnover ? 'bg-orange-50 dark:bg-orange-900/10' : 'bg-white dark:bg-slate-800'}`}>
                                            {/* Header */}
                                            <div className="flex justify-between items-center mb-1">
                                                <span className={`text-sm font-bold ${isTurnover ? 'text-orange-700' : 'text-slate-700 dark:text-slate-200'}`}>{day}</span>
                                                {dayData && (
                                                    <button 
                                                        onClick={() => handleWhatsAppShare(dayData.date, dayData.events, dayData.hasTurnover)}
                                                        className="text-green-500 hover:text-green-600 transition-transform hover:scale-110"
                                                        title="WhatsApp"
                                                    >
                                                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                                                    </button>
                                                )}
                                            </div>

                                            {/* Events List */}
                                            <div className="space-y-1">
                                                {dayData && (() => {
                                                    const checkOuts = dayData.events.filter(e => e && e.type === 'Check-out');
                                                    const linens = dayData.events.filter(e => e && e.type === 'Troca de Enxoval' && e.status !== 'declined');
                                                    const checkIns = dayData.events.filter(e => e && e.type === 'Check-in');
                                                    
                                                    return (
                                                        <>
                                                            {checkOuts.map(e => (
                                                                <div key={e.id} className="text-[10px] leading-tight text-red-600 font-semibold truncate flex items-center gap-1" title={`Check-out: ${e.reservation.guestName}`}>
                                                                    <span>👋</span> {e.reservation.guestName.split(' ')[0]} ({e.reservation.flat})
                                                                </div>
                                                            ))}
                                                            {linens.map(e => (
                                                                <div key={e.id} className="text-[10px] leading-tight text-blue-600 font-medium truncate flex items-center gap-1" title={`Troca: ${e.reservation.guestName}`}>
                                                                    <span>🧺</span> {e.reservation.guestName.split(' ')[0]} ({e.reservation.flat})
                                                                </div>
                                                            ))}
                                                            {checkIns.map(e => (
                                                                <div key={e.id} className="text-[10px] leading-tight text-green-600 font-semibold truncate flex items-center gap-1" title={`Check-in: ${e.reservation.guestName}`}>
                                                                    <span>🛎️</span> {e.reservation.guestName.split(' ')[0]} ({e.reservation.flat})
                                                                </div>
                                                            ))}
                                                        </>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ReceptionCleaningReport;
