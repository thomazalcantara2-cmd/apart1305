/**
 * Determina como as Taxas de Plataforma devem ser tratadas no relatório,
 * com corte limpo por ano.
 *
 * Regra (definida em conversa de 06/05/2026):
 *   - Anos <= 2025: Taxas de Plataforma aparecem como linha de despesa,
 *     receita usa `grossEarnings` (modelo histórico).
 *   - Anos >= 2026: Taxas saem das despesas; a receita já vem líquida
 *     da taxa (= `netEarnings`), e o rótulo passa a ser apenas "Receita".
 *
 * Esta função é o ÚNICO ponto de decisão. Se um dia o critério mudar
 * (ex.: virar configurável no painel), basta alterar aqui.
 */
export const FEE_AS_EXPENSE_CUTOFF_YEAR = 2025;

export const isFeesAsExpense = (year: number): boolean => {
    return year <= FEE_AS_EXPENSE_CUTOFF_YEAR;
};

/**
 * Rótulo da linha/coluna de receita conforme o ano.
 * - Até 2025: "Receita Bruta" (taxas ainda saem como despesa abaixo)
 * - 2026+: "Receita" (já líquida das taxas da plataforma)
 */
export const getRevenueLabel = (year: number): string => {
    return isFeesAsExpense(year) ? 'Receita Bruta' : 'Receita';
};

/**
 * Calcula a receita de uma reserva conforme o ano de competência.
 * - Até 2025: grossEarnings
 * - 2026+: netEarnings (= grossEarnings - fees)
 */
export const getReservationRevenue = (
    res: { grossEarnings: number; netEarnings: number },
    year: number
): number => {
    return isFeesAsExpense(year) ? res.grossEarnings : res.netEarnings;
};
