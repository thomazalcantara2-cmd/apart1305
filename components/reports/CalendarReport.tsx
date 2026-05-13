
import React, { useMemo, useState } from 'react';
import { Reservation } from '../../types';
import { formatDate, formatCurrency, getMonthName } from '../../utils/helpers';

interface Props {
    reservations: Reservation[];
    selectedYear: number;
    selectedMonth: number;
}

// Icons for Platforms
const PlatformIcon: React.FC<{ platform: string, className?: string }> = ({ platform, className = "w-3 h-3" }) => {
    const p = platform.toLowerCase();
    if (p.includes('airbnb')) {
        return (
            <svg className={className} viewBox="0 0 24 24" fill="currentColor" style={{ color: '#FF385C' }}>
                <path d="M22.5 13.5c0 1.5-.7 2.8-1.9 3.7-1.1.9-2.6 1.3-4.1 1.3-1.6 0-3.1-.6-4.5-1.7-1.4 1.1-2.9 1.7-4.5 1.7-1.5 0-3-.4-4.1-1.3-1.2-.9-1.9-2.2-1.9-3.7 0-2.4 2-4.8 4.7-7.3 1.9-1.7 4-3.4 5.8-5.3.1-.1.3-.1.4 0 1.8 1.9 3.9 3.6 5.8 5.3 2.7 2.5 4.7 4.9 4.3 7.3zm-10.3-8.6c-1.7 1.8-3.7 3.4-5.5 5-2.4 2.2-4.2 4.3-4.2 6.1 0 .9.4 1.7 1.1 2.3.7.5 1.6.8 2.6.8 1.4 0 2.8-.7 4.1-2.2.5-.6.8-1.2.9-1.8.2.7.5 1.3.9 1.8 1.3 1.5 2.7 2.2 4.1 2.2.9 0 1.9-.3 2.6-.8.7-.6 1.1-1.4 1.1-2.3 0-1.8-1.8-3.9-4.2-6.1-1.7-1.6-3.7-3.2-5.5-5z"/>
            </svg>
        );
    }
    if (p.includes('booking')) {
        return (
            <svg className={className} viewBox="0 0 24 24" fill="currentColor" style={{ color: '#003580' }}>
                <path d="M15.2 9.4c-.6 0-1.1.2-1.5.5-.4.3-.6.8-.6 1.3 0 .6.2 1.1.6 1.4.4.3.9.5 1.5.5.6 0 1.1-.2 1.5-.5.4-.3.6-.8.6-1.4 0-.5-.2-1-.6-1.3-.4-.3-.9-.5-1.5-.5zM22 2H2v20h20V2zM7.5 16.5c-1.2 0-2.1-.4-2.8-1.2-.7-.8-1-1.9-1-3.2 0-1.3.3-2.4 1-3.2.7-.8 1.6-1.2 2.8-1.2 1.1 0 2 .4 2.7 1.1.7.8 1 1.8 1 3.1v.2h-5.2c.1 1 .3 1.7.8 2.2.5.5 1.1.7 1.8.7.6 0 1.1-.1 1.6-.4.5-.2.8-.6 1.1-1l1.3.8c-.4.6-1 1.2-1.7 1.5-.8.4-1.8.6-2.9.6zm8-1.6c-.9.7-2.1 1.1-3.4 1.1-1.2 0-2.2-.3-2.9-.9-.7-.6-1-1.5-1-2.7h1.6c0 .7.2 1.3.5 1.6.4.3.9.5 1.5.5.6 0 1.1-.2 1.4-.5.3-.3.5-.8.5-1.4 0-.5-.1-.9-.4-1.2-.3-.3-.7-.5-1.4-.7-.9-.2-1.7-.5-2.2-.8-.6-.3-.9-.9-.9-1.7 0-1 .4-1.9 1.1-2.5.7-.6 1.7-.9 2.9-.9 1.1 0 2.1.3 2.8.9.7.6 1.1 1.4 1.1 2.6h-1.6c0-.6-.2-1.1-.5-1.4-.3-.3-.8-.5-1.3-.5-.5 0-.9.1-1.2.4-.3.3-.4.6-.4 1.1 0 .4.1.8.4 1 .3.3.8.5 1.5.7.9.2 1.7.5 2.2.9.5.4.8.9.8 1.7 0 1.1-.4 2.1-1.1 2.7z"/>
            </svg>
        );
    }
    if (p.includes('decolar')) {
        return (
            <svg className={className} viewBox="0 0 24 24" fill="currentColor" style={{ color: '#FA503F' }}>
                <circle cx="12" cy="12" r="10" />
            </svg>
        );
    }
    return (
        <svg className={`${className} text-gray-500`} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
        </svg>
    );
};

const ReservationDetailModal: React.FC<{ reservation: Reservation; onClose: () => void }> = ({ reservation, onClose }) => {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className={`p-4 ${reservation.platform.toLowerCase().includes('booking') ? 'bg-blue-600' : reservation.platform.toLowerCase().includes('airbnb') ? 'bg-red-500' : 'bg-gray-600'} text-white flex justify-between items-center`}>
                    <h3 className="font-bold text-lg">{reservation.platform}</h3>
                    <button onClick={onClose} className="text-white hover:text-gray-200 text-2xl">&times;</button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <p className="text-sm text-slate-500 dark:text-slate-400 uppercase font-semibold">Hóspede</p>
                        <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{reservation.guestName}</p>
                        <p className="text-sm text-slate-600 dark:text-slate-300">Flat {reservation.flat}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-sm text-slate-500 dark:text-slate-400 font-semibold">Check-in</p>
                            <p className="text-slate-800 dark:text-slate-200">{formatDate(reservation.checkIn)}</p>
                        </div>
                        <div>
                            <p className="text-sm text-slate-500 dark:text-slate-400 font-semibold">Check-out</p>
                            <p className="text-slate-800 dark:text-slate-200">{formatDate(reservation.checkOut)}</p>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-700/50 p-3 rounded-md">
                        <div className="flex justify-between items-center">
                            <span className="text-slate-600 dark:text-slate-300">Valor Bruto</span>
                            <span className="font-semibold text-slate-800 dark:text-slate-100">{formatCurrency(reservation.grossEarnings)}</span>
                        </div>
                        <div className="flex justify-between items-center mt-1">
                            <span className="text-slate-600 dark:text-slate-300">Taxas</span>
                            <span className="text-red-500 text-sm">-{formatCurrency(reservation.fees)}</span>
                        </div>
                        <div className="border-t border-slate-200 dark:border-slate-600 my-2"></div>
                        <div className="flex justify-between items-center">
                            <span className="font-bold text-slate-700 dark:text-slate-200">Líquido</span>
                            <span className="font-bold text-green-600 text-lg">{formatCurrency(reservation.netEarnings)}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const CalendarReport: React.FC<Props> = ({ reservations, selectedYear, selectedMonth }) => {
    const [selectedRes, setSelectedRes] = useState<Reservation | null>(null);

    const flats = useMemo(() => ['201', '202', '301'], []);
    const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    const viewStart = useMemo(() => new Date(Date.UTC(selectedYear, selectedMonth - 1, 1)), [selectedYear, selectedMonth]);
    const viewEnd = useMemo(() => new Date(Date.UTC(selectedYear, selectedMonth, 1)), [selectedYear, selectedMonth]);

    const currentReservations = useMemo(() => {
        return reservations.filter(r => {
            // Check if reservation overlaps with the current month
            return r.checkIn < viewEnd && r.checkOut > viewStart;
        });
    }, [reservations, viewStart, viewEnd]);

    // Group reservations by Flat and calculate swimlanes (tracks)
    const flatTracks = useMemo(() => {
        const tracks: Record<string, Reservation[][]> = {}; // Flat -> Array of Rows (Tracks)

        flats.forEach(flat => {
            const flatRes = currentReservations
                .filter(r => r.flat === flat)
                .sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime());

            const rows: Reservation[][] = [];

            flatRes.forEach(res => {
                let placed = false;
                // Try to fit in existing rows
                for (const row of rows) {
                    const lastResInRow = row[row.length - 1];
                    
                    if (res.checkIn.getTime() >= lastResInRow.checkOut.getTime()) {
                        row.push(res);
                        placed = true;
                        break;
                    }
                }
                // If didn't fit in any row, start a new one
                if (!placed) {
                    rows.push([res]);
                }
            });
            tracks[flat] = rows.length > 0 ? rows : [[]]; // Ensure at least one empty row
        });
        return tracks;
    }, [currentReservations, flats]);

    const getGridPosition = (res: Reservation) => {
        // Calculate start and end columns based on day of month
        // Grid Column 1 = Label
        // Grid Column 2 = Day 1
        // Grid Column 3 = Day 2
        
        // Start Day
        const startDay = res.checkIn.getUTCDate();
        let startCol = startDay + 1; // Default offset

        // Handle start before month
        if (res.checkIn < viewStart) {
            startCol = 2; // Start at Day 1 column
        }

        // End Day
        const endDay = res.checkOut.getUTCDate();
        let endCol = endDay + 1;

        // Handle end after month
        if (res.checkOut >= viewEnd) {
            endCol = daysInMonth + 2; // Extend to end of grid
        }
        
        return {
            gridColumnStart: startCol,
            gridColumnEnd: endCol
        };
    };

    const isWeekend = (day: number) => {
        const date = new Date(selectedYear, selectedMonth - 1, day);
        const dayOfWeek = date.getDay();
        return dayOfWeek === 0 || dayOfWeek === 6;
    };

    const isToday = (day: number) => {
        const today = new Date();
        return today.getDate() === day && 
               today.getMonth() + 1 === selectedMonth && 
               today.getFullYear() === selectedYear;
    };

    return (
        <div className="card h-full bg-white dark:bg-slate-800 shadow-md rounded-lg overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center">
                <h2 className="text-lg font-bold text-slate-700 dark:text-slate-200">
                    CALENDÁRIO DE RESERVAS - {getMonthName(selectedMonth).toUpperCase()}/{selectedYear}
                </h2>
                <div className="flex gap-2 text-xs">
                    <div className="flex items-center gap-1"><div className="w-3 h-3 bg-red-500 rounded"></div> Airbnb</div>
                    <div className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-600 rounded"></div> Booking</div>
                    <div className="flex items-center gap-1"><div className="w-3 h-3 bg-orange-500 rounded"></div> Decolar</div>
                </div>
            </div>

            {/* Scrollable Timeline */}
            <div className="flex-grow overflow-x-auto overflow-y-auto custom-scrollbar relative">
                <div className="flex flex-col min-w-max">
                     {/* Header */}
                     <div className="flex sticky top-0 z-40 shadow-sm">
                        <div className="w-24 flex-shrink-0 bg-slate-100 dark:bg-slate-800 p-2 border-b border-r border-slate-300 dark:border-slate-600 font-bold text-slate-700 dark:text-slate-200 z-50">
                            Flat
                        </div>
                        <div className="flex flex-grow bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-600">
                            {days.map(day => (
                                <div key={day} className={`flex-1 min-w-[40px] p-1 text-center border-r border-slate-200 dark:border-slate-700 flex flex-col justify-center ${isWeekend(day) ? 'bg-slate-200/50 dark:bg-slate-700/50' : ''} ${isToday(day) ? 'bg-blue-100 dark:bg-blue-900' : ''}`}>
                                    <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase">{new Date(selectedYear, selectedMonth - 1, day).toLocaleDateString('pt-BR', { weekday: 'short' }).substring(0,3)}</span>
                                    <span className={`text-sm font-bold ${isToday(day) ? 'text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-200'}`}>{day}</span>
                                </div>
                            ))}
                        </div>
                     </div>

                     {/* Body */}
                     {flats.map(flat => {
                         const tracks = flatTracks[flat];
                         return (
                             <div key={flat} className="flex border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                                 {/* Sidebar */}
                                 <div className="w-24 flex-shrink-0 p-4 border-r border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 flex items-center justify-center bg-white dark:bg-slate-800 sticky left-0 z-30">
                                     Flat {flat}
                                 </div>
                                 
                                 {/* Content Area */}
                                 <div className="flex-grow flex flex-col relative">
                                     {tracks.map((track, trackIdx) => (
                                         <div key={trackIdx} className="h-14 relative w-full flex border-b border-slate-100 dark:border-slate-800 last:border-0">
                                             {/* Background Grid Cells */}
                                             <div className="absolute inset-0 flex w-full h-full">
                                                 {days.map(day => (
                                                     <div key={day} className={`flex-1 border-r border-slate-100 dark:border-slate-700/30 ${isWeekend(day) ? 'bg-slate-50/80 dark:bg-slate-800/80' : ''} ${isToday(day) ? 'bg-blue-50/30 dark:bg-blue-900/10' : ''}`}></div>
                                                 ))}
                                             </div>

                                             {/* Reservations */}
                                             <div className="absolute inset-0 w-full h-full grid" style={{ gridTemplateColumns: `repeat(${daysInMonth}, 1fr)` }}>
                                                 {track.map(res => {
                                                     const pos = getGridPosition(res);
                                                     // Adjust grid column for 0-based calculation inside this container (no sidebar offset)
                                                     const colStart = pos.gridColumnStart - 1; // Remove sidebar offset
                                                     const colEnd = pos.gridColumnEnd - 1;
                                                     
                                                     let bgClass = "bg-gray-500";
                                                     const p = res.platform.toLowerCase();
                                                     if (p.includes('airbnb')) bgClass = "bg-red-500";
                                                     else if (p.includes('booking')) bgClass = "bg-blue-600";
                                                     else if (p.includes('decolar')) bgClass = "bg-orange-500";

                                                     return (
                                                         <div
                                                             key={res.id}
                                                             onClick={() => setSelectedRes(res)}
                                                             className={`
                                                                 ${bgClass} m-1 rounded shadow-sm cursor-pointer hover:brightness-110 hover:shadow-md 
                                                                 text-white text-xs flex items-center px-2 overflow-hidden whitespace-nowrap z-10
                                                             `}
                                                             style={{
                                                                 gridColumnStart: colStart,
                                                                 gridColumnEnd: colEnd,
                                                             }}
                                                             title={`${res.guestName}\n${formatDate(res.checkIn)} - ${formatDate(res.checkOut)}`}
                                                         >
                                                             <PlatformIcon platform={res.platform} className="w-3 h-3 mr-1 text-white opacity-80" />
                                                             <span className="font-semibold truncate">{res.guestName}</span>
                                                         </div>
                                                     );
                                                 })}
                                             </div>
                                         </div>
                                     ))}
                                 </div>
                             </div>
                         );
                     })}
                </div>
            </div>

            {selectedRes && (
                <ReservationDetailModal 
                    reservation={selectedRes} 
                    onClose={() => setSelectedRes(null)} 
                />
            )}
        </div>
    );
};

export default CalendarReport;
