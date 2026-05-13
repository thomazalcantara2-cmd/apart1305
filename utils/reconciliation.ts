import { Reservation, BankDeposit, MatchedPair } from '../types';

const getAdjustedNet = (res: Reservation, manualAdjustments: Record<string, number>) => res.netEarnings - (manualAdjustments[res.id] || 0);

export const performAutoReconciliation = (
    reservations: Reservation[],
    deposits: BankDeposit[],
    manualAdjustments: Record<string, number>
): { 
    matchedPairs: MatchedPair[], 
    allReservations: (Reservation & { adjustedNet: number, matched: boolean })[] , 
    allDeposits: (BankDeposit & { matched: boolean })[] 
} => {
    const reservationsToMatch = reservations
        .filter(r => r.flat !== '301' && r.platform !== 'Particular')
        .map(r => ({ ...r, adjustedNet: getAdjustedNet(r, manualAdjustments), matched: false }));

    const depositsToMatch = deposits.map(d => ({ ...d, matched: false }));
    const matchedPairs: MatchedPair[] = [];

    // --- PHASE 0: Pre-defined Special Matches ---
    
    // Regra Específica: Depósito Agrupado da Booking
    const specialDepositAmount = 40611.23;
    const specialGuestNames = [
        "CLAUDIO FERREIRA DA SILVA JUNIOR", "CLEUZA BARCELOS", "LEONARDO BRUNO ABREU DE SOUZA", 
        "LUCAS SAID DE OLIVEIRA", "ALESSANDRA RODRIGUES", "GASTON EZEQUIEL CAPIELLO", 
        "ROGER MONTEIRO", "MAIARA RODRIGUES SILVA", "JULIA MELENDEZ", 
        "LAYLA ANDREA BARAQUI CALLEJAS", "CARLOS ROBERTO PACHECO", "MARIA SOL FLORES ARAGON", 
        "SIMONE SILVA SANTOS", "CINTHYA RUIZ", "ALTAMIRANO ANA", "YOEL ALEXIS RODRIGUEZ", 
        "ALBANO CARLOS LAIN FLORES", "JUAN PABLO PANE", "VINICIUS COSTA REGO", 
        "EDERSON DEODATO", "CRISTIANE CHAVES GATTAZ", "TADEU SPOSITO DO AMARAL", 
        "JULIETA SOUZA DIAS", "DECIO DE O RODRIGUES"
    ].map(name => name.toUpperCase());

    const bookingSpecialIndex = depositsToMatch.findIndex(dep => !dep.matched && Math.abs(dep.amount - specialDepositAmount) < 1.0);
    if (bookingSpecialIndex !== -1) {
        const dep = depositsToMatch[bookingSpecialIndex];
        const matches = reservationsToMatch.filter(res => !res.matched && specialGuestNames.some(name => res.guestName.toUpperCase().includes(name)));
        if (matches.length > 0) {
            dep.matched = true;
            matches.forEach(res => { res.matched = true; });
            matchedPairs.push({ reservations: matches, deposit: dep, type: 'Pre-defined' });
        }
    }
    
    // CASO ESPECÍFICO: DECOLAR SALDO DEZ/24 (Recebido em Jan/25)
    // FIX: Valor exato solicitado de R$ 6.321,48
    const decolarSpecialAmount = 6321.48;
    const decolarSpecialIndex = depositsToMatch.findIndex(
        dep => !dep.matched && 
               Math.abs(dep.amount - decolarSpecialAmount) < 0.01 && 
               dep.description.toUpperCase().includes('DECOLAR')
    );
    
    if (decolarSpecialIndex !== -1) {
        const deposit = depositsToMatch[decolarSpecialIndex];
        deposit.matched = true;
        
        const ghostReservation: Reservation = {
            id: 'ghost-decolar-dec-2024',
            checkIn: new Date(Date.UTC(2025, 0, 23)),
            checkOut: new Date(Date.UTC(2025, 0, 23)),
            guestName: "SALDO DECOLAR (REF. DEZ/24)",
            flat: "Geral", // Identificado como geral para aparecer nos relatórios do negócio principal
            platform: "DECOLAR",
            grossEarnings: deposit.amount,
            fees: 0,
            netEarnings: deposit.amount
        };
        
        matchedPairs.push({
            reservations: [ghostReservation],
            deposit: deposit,
            type: 'Pre-defined'
        });
    }

    // Outros casos específicos...
    const tiagoFassinaAmount = 3900.72;
    const tiagoDepositIndex = depositsToMatch.findIndex(dep => !dep.matched && Math.abs(dep.amount - tiagoFassinaAmount) < 0.01 && dep.description.toUpperCase().includes('TIAGO'));
    if (tiagoDepositIndex !== -1) {
        const res = reservationsToMatch.find(r => !r.matched && r.guestName.includes('TIAGO FASSINA'));
        if (res) {
            depositsToMatch[tiagoDepositIndex].matched = true;
            res.matched = true;
            matchedPairs.push({ reservations: [res], deposit: depositsToMatch[tiagoDepositIndex], type: 'Pre-defined' });
        }
    }

    // --- PHASE 1: Direct 1-to-1 Matches ---
    reservationsToMatch.forEach(res => {
        if (res.matched) return; 
        const depositIndex = depositsToMatch.findIndex(dep => !dep.matched && Math.abs(dep.amount - res.adjustedNet) < 0.01);
        if (depositIndex !== -1) {
            res.matched = true;
            depositsToMatch[depositIndex].matched = true;
            matchedPairs.push({ reservations: [res], deposit: depositsToMatch[depositIndex], type: '1-to-1' });
        }
    });

    // --- PHASE 2: Simple 2-to-1 Sum Matches ---
    const remainingReservations = reservationsToMatch.filter(r => !r.matched);
    if (remainingReservations.length > 1) {
        for (let i = 0; i < remainingReservations.length; i++) {
            for (let j = i + 1; j < remainingReservations.length; j++) {
                const res1 = remainingReservations[i];
                const res2 = remainingReservations[j];
                if (res1.matched || res2.matched) continue;
                const sumToMatch = res1.adjustedNet + res2.adjustedNet;
                const depositIndex = depositsToMatch.findIndex(dep => !dep.matched && Math.abs(dep.amount - sumToMatch) < 0.01);
                if (depositIndex !== -1) {
                    res1.matched = true;
                    res2.matched = true;
                    depositsToMatch[depositIndex].matched = true;
                    matchedPairs.push({ reservations: [res1, res2], deposit: depositsToMatch[depositIndex], type: 'Sum' });
                }
            }
        }
    }

    return { 
        matchedPairs, 
        allReservations: reservationsToMatch, 
        allDeposits: depositsToMatch 
    };
};