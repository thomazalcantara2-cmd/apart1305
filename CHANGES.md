# Mudanças aplicadas — 12/05/2026 — Suporte extrato BTG Pactual + remapeação tolerante de conciliações manuais

## Resumo
Dois ajustes independentes no mesmo patch:

1. **Importação de extrato no formato BTG Pactual** (PDF e Excel). O novo layout descreve cada lançamento em 2–3 linhas (descrição quebrada em "Pix recebido de BANCO INTER SA" / "Banco 077 | CNPJ ... | Mensagem - Pagamento" / "Airbnb - ...") e usa duas colunas numéricas (Entradas/Saídas + Saldo) em vez de uma. Os parsers passam a reconhecer e agregar essas linhas antes de mapear contra as keywords padrão (Airbnb = "TRANSFERÊNCIA A CRÉDITO VIA PIX - BANCO INTER"; Booking = "TED RECEBIDA - BOOKING.COM"). Formatos antigos (Bradesco etc.) mantêm o comportamento prévio intacto.

2. **Conciliações manuais sobrevivem a reimportações de planilha e a novos depósitos.** Antes, conciliações salvas no Google Sheets apontavam para IDs que podiam mudar entre cargas (sufixos de desempate `-2/-3` em depósitos duplicados e diacríticos em nomes de hóspedes via `slugify`). Adicionada remapeação tolerante por assinatura (`flat | check-in | nome normalizado` para reservas; `data | valor | descrição normalizada` para depósitos) que reaponta IDs órfãos em memória durante `loadData`. Persistência ocorre naturalmente na próxima vez que o usuário salvar uma conciliação na UI.

## Parte 1 — Parsers de extrato

### `utils/pdfParser.ts`
- Detector de layout: ativa modo BTG quando a página contém "BTG PACTUAL" ou os três cabeçalhos "Data lançamento" + "Entradas / Saídas (R$)" + "Saldo (R$)".
- Modo BTG: para cada linha-âncora com data, agrega até 2 linhas adjacentes (acima/abaixo) sem data própria para reconstruir a descrição completa antes do matching. Valor extraído do **penúltimo** número da linha-âncora (a última coluna = Saldo, descartada).
- Função `mapDescriptionToKeyword` centralizada (reutilizada por ambos os modos), com regras adicionais: `PAGAMENTO AIRBNB` / `PIX AIRBNB` → Airbnb; reconhecimento explícito de `TED RECEBIDA DE BOOKING.COM BRASIL SERVICOS DE`.
- Modo legado (Bradesco e similares): comportamento idêntico ao anterior — uma linha por lançamento.

### `utils/excelStatementParser.ts`
- Detecta planilhas BTG pela presença do cabeçalho "Saldo (R$)" e ativa agregação de células de descrição quando o export vem com a descrição quebrada em múltiplas linhas (data preenchida só na linha-âncora).
- Header scan agora é por-linha (não persistente entre iterações), evitando que cabeçalhos parciais de preâmbulo poluam os índices de coluna.
- Adicionados matchers: `TED RECEBIDA DE BOOKING.COM BRASIL SERVICOS` → Booking; `PAGAMENTO AIRBNB` / `PIX AIRBNB` → Airbnb.
- Helper `parseCell` tolera "R$ 1.234,56", valores numéricos nativos do XLSX e strings vazias.
- Prioridade de coluna corrigida: layout legado usa "Valor (R$)"; layout BTG (sem essa coluna) cai automaticamente em "Entradas / Saídas (R$)". Bug anterior: Booking/Decolar em extratos BTG eram silenciosamente descartados por falta da coluna "Valor".

## Parte 2 — Remapeação tolerante de conciliações

### Causa raiz
- `ManualConciliation` é persistida como `{ reservationIds: string[], depositIds: string[] }` no Google Sheets.
- IDs são regerados a cada `loadData` por `processReservations`/`processDeposits` em `services/dataService.ts`.
- Dois caminhos de instabilidade dos IDs:
  - Depósitos duplicados (Booking) recebiam sufixo `-2`, `-3` cuja atribuição depende da ordem das linhas no arquivo importado.
  - `slugify` removia diacríticos via `[^\w-]+` (no JavaScript, `\w` é ASCII), apagando letras acentuadas em vez de normalizá-las: "AGUSTÍN" virava `agustn...` (sem o `í`), e qualquer reexport do Airbnb/Booking com grafia ligeiramente diferente gerava ID divergente.

### `utils/conciliationMigration.ts` (NOVO)
- Expõe `remapManualConciliations` e `remapDismissedAutoMatches`.
- Para cada ID antigo que não bate no conjunto atual, faz busca por **assinatura** (mais robusta que comparação textual de ID):
  - Reservas: `flat | data de check-in ISO | nome normalizado` (NFD + remoção de combining marks + lowercase + filtro alfanumérico, sem corte de comprimento).
  - Depósitos: `data ISO | valor em centavos | descrição normalizada` (até 30 chars).
- Consumo global: cada registro atual só pode ser usado uma vez na remapeação, evitando que duas conciliações antigas reivindiquem o mesmo registro novo.
- Conciliações que perdem todas as reservas ou todos os depósitos são descartadas (contadas em `droppedCount`).
- Devolve flag `changed` para o caller decidir se vale persistir.

### `App.tsx`
- `loadData` chama `remapManualConciliations` e `remapDismissedAutoMatches` antes de chamar `setManualConciliations` / `setDismissedAutoMatches`.
- Remapeação roda apenas em memória — não persiste automaticamente. A versão corrigida é gravada no Google Sheets naturalmente na próxima vez que o usuário criar ou desfazer uma conciliação na UI (via `saveManualConciliations` que já passa a lista inteira).
- Console exibe `[conciliationMigration] ... IDs remapeados, ... órfãs descartadas` quando algo é ajustado, útil para auditoria.

### `services/dataService.ts`
- `slugify` agora chama `.normalize('NFD').replace(/[\u0300-\u036f]/g, '')` antes do filtro `[^\w-]+`. "AGUSTÍN MAXIMILIANO" → `agustinmaximili` (em vez de `agustnmaximilia`).
- IDs de reservas tornam-se estáveis daqui para frente para nomes com acento. Reservas históricas com slug antigo são recuperadas automaticamente pela remapeação tolerante (`conciliationMigration`).
- Função `processReservations` e `processDeposits` inalteradas no resto — apenas o slugify ficou mais robusto.

## Validação
- 6 cenários de teste integrados rodados contra `conciliationMigration` (depósitos duplicados com ordem invertida, hóspede com acento, grupo "RAMIRO + DANIEL + AGUSTIN", reserva removida, sem mudanças, dismissed matches): todos passam.
- Parser PDF testado contra um extrato BTG real de 09/05/2026: extrai as 4 transações com valores corretos (R$ 2.236,88 / 1.150,84 / 6.008,40 / 986,28), descartando saldos e linhas de "Saldo de abertura/fechamento".
- Parser Excel testado contra 3 layouts (Bradesco legado, BTG single-row com `\n`, BTG multi-row com descrição quebrada): todos extraem corretamente.
- `tsc --noEmit` e `vite build` passam (apenas 3 erros pré-existentes em `Dashboard.tsx` e `FinancialReport.tsx` não relacionados a este patch).

---

# Mudanças aplicadas — 06/05/2026 — Reforma de taxas + aba "Competência × Caixa"

## Resumo
Duas mudanças paralelas, mesmo patch:

1. **Taxas de Plataforma deixam de ser despesa a partir de 2026.** A partir de 2026, a receita exibida já vem líquida das taxas (= `netEarnings`); até 2025, comportamento histórico preservado (receita bruta + linha de despesa "Taxas de Plataforma"). Corte é por ano, sem reescrita do passado.
2. **Nova aba "Competência × Caixa".** Compara, por mês, as reservas com check-in no período (regime de competência) com o que efetivamente foi depositado pelas plataformas (regime de caixa).

## Parte 1 — Taxas de Plataforma

### Helper central (NOVO arquivo)
- **`utils/feeMode.ts`** — concentra a regra: `isFeesAsExpense(year)`, `getRevenueLabel(year)`, `getReservationRevenue(res, year)`. Único ponto de decisão; se um dia o critério mudar (ex: virar configurável), troca-se aqui.

### Arquivos alterados

#### `components/reports/FinancialReport.tsx` — Relatório Mensal (Competência)
- Receita: `grossEarnings` (até 2025) → `netEarnings` (2026+).
- "Taxas de Plataforma" sai da lista de despesas em 2026+ e o dataset desaparece do gráfico (não vira barra com 0 nem entrada na legenda).
- KPI Card "Receita Bruta" → "Receita" em 2026+ (via `getRevenueLabel`).
- Tabela de detalhes na tela: 2026+ exibe apenas `[FLAT, HÓSPEDE, CHECK-IN, RECEITA]`; 2025 e antes mantém as 6 colunas com bruto/taxa/líquido.
- Exportação PDF e Excel ajustadas com o mesmo critério.
- Resumo PDF mostra "Receita" ou "Receitas Brutas" conforme o ano.
- Cálculo de yearlyFinancials (gráfico anual no topo) também respeita o critério.

#### `components/reports/YearlyFinancialSummaryReport.tsx` — Relatório Anual (Competência)
- `monthlyRevenue` usa `getReservationRevenue(res, year)`.
- "Taxas de Plataforma" só entra em `expenseDetails` se ano ≤ 2025.
- `totalExpenses` ignora `platformFees` em 2026+.
- Modal de detalhes do mês (`detailsData`, `flatMatrixData`) usa o mesmo critério.

#### `components/Dashboard.tsx`
- Cálculo de `grossRevenue` e `totalExpenses` por mês respeita o ano de cada cálculo (importante porque o dashboard pré-calcula 12 meses do ano atual e do ano anterior — cada um com seu próprio critério).
- `platformRev` e `flatRev` (gráficos de receita por plataforma/flat) usam o critério.
- **ADR (diária média) preserva `grossEarnings`** sempre, independente do ano. ADR é métrica de mercado (qual diária está sendo praticada), e mudar para net distorceria comparações históricas de pricing.

### Decisões deliberadas (NÃO alterados)
- `types.ts` — `Reservation.fees` segue existindo no modelo. Mudança é só de apresentação.
- `services/dataService.ts` — segue calculando `netEarnings = grossEarnings - fees`.
- `utils/reconciliation.ts` — usa `netEarnings`, já correto para ambos os regimes.
- `components/reports/CashFlowReport.tsx` / `YearlyCashFlowReport.tsx` — regime de caixa puro, não toca em `fees`.
- `components/reports/CarneLeaoReport.tsx` / `FiscalReport.tsx` / `NfseControlReport.tsx` — Carnê Leão não é mais usado em 2026; abas seguem intactas para consultar histórico.
- `components/reports/DynamicPricingReport.tsx` — ADR continua em `grossEarnings` (mesma lógica do Dashboard).
- `components/reports/CalendarReport.tsx` / `ReceptionCleaningReport.tsx` — telas operacionais, mantêm exibição de bruto + taxa + líquido como informação útil.

## Parte 2 — Aba "Competência × Caixa"

### Novo arquivo
- **`components/reports/CashAccrualCompareReport.tsx`** — visão mensal de conciliação por competência.

### Estrutura da aba
- **Filtro de flats** (201/202/301) — independente do filtro do Relatório Mensal.
- **4 KPIs no topo**: Receita esperada (competência), Já recebida, Pendente, Status geral.
- **Tabela por plataforma** (Airbnb / Booking / Decolar / Particular / Outros): nº de reservas, esperado, recebido, pendente, badge de status, botão "Ver detalhes".
- **Detalhe expandido por plataforma**: lista cada reserva com hóspede, flat, check-in, esperado, recebido e badge de status.
- **Bloco "Depósitos do mês sem reserva conciliada"**: depósitos que caíram no mês mas não casaram com nada (úteis para revisar conciliações).

### Lógica de status por reserva
- ✅ **Pago em [Mês/Ano]** — conciliada com depósito; cor verde se depósito caiu no mesmo mês da competência, azul se em outro mês.
- ⚠️ **Divergência** — conciliada mas valor recebido difere do esperado em mais de R$ 0,50 (mostra a diferença).
- ⏳ **Aguardando depósito** — não casou com nenhum depósito.
- 🔵 **Particular** — paga direto, considerada quitada (não passa pelo banco).

### Lógica de divisão proporcional (depósitos agrupados)
Quando uma reserva está num par `Sum`/`Pre-defined` (depósito casou com várias reservas), o valor recebido individual é calculado proporcionalmente ao `netEarnings` da reserva sobre o total `netEarnings` do grupo.

### Atalho "Conciliar →" / "Revisar →"
Botão na linha da reserva pendente ou divergente leva direto para a aba "Conciliação manual" com aquela reserva pré-selecionada.

### Arquivos alterados para suportar o atalho
- **`types.ts`** — adicionado `ReportType.CashAccrualCompare = 'cashAccrualCompare'`.
- **`components/Sidebar.tsx`** — adicionado item "Competência × Caixa" no grupo "Regime de Caixa".
- **`App.tsx`** — adicionado import, estado `pendingManualConciliationReservationId`, e roteamento da nova aba; `InteractiveCompensationReport` passou a receber `initialSelectedReservationId` e `onInitialSelectionConsumed`.
- **`components/reports/InteractiveCompensationReport.tsx`** — duas props opcionais novas (`initialSelectedReservationId`, `onInitialSelectionConsumed`); `useEffect` aplica a seleção inicial e dispara o callback de limpeza.

## Validação
- `vite build` → ✅ sucesso
- `tsc --noEmit` → 4 erros pré-existentes (Chart.js em Dashboard.tsx e FinancialReport.tsx), nenhum introduzido por esta mudança.

---

# Mudanças aplicadas — Importação no formato Ape-Codex

## Problema
O painel não estava recebendo os dados da planilha base porque `processReservations` esperava um array de objetos (`Record<string, any>[]`), mas o backend Apps Script retorna `reservationsData` como matriz `any[][]` (linha 0 = cabeçalho), formato original do Ape-Codex.

## Arquivos alterados

### 1. `services/dataService.ts`
- **`processReservations(rows: any[][])`** — restaurado para receber matriz, exatamente como no Ape-Codex. Constrói `headerMap` a partir da linha 0, tolera `chegada` ou `data de check-in`, e mantém toda a normalização de flats (201/202/301), canais (AIRBNB/BOOKING/DECOLAR/Particular) e geração de `stableId`.
- **`uploadReservationsSheet(sheetData: any[][], month?, year?)`** — agora envia matriz pura (igual ao Ape-Codex). Os parâmetros `month`/`year` continuam opcionais para o backend usar como filtro de substituição parcial; quando omitidos, o backend faz substituição completa.
- **`uploadDepositsSheet`** — `month`/`year` também opcionais agora (assinatura compatível com o uso anterior).
- Mantidas todas as adições do painel: `dismissedAutoMatches` em `fetchInitialData`, `saveDismissedAutoMatches`, `saveNfseData`, `saveNewReservation`, `saveManualConciliations`, `saveConfigData`.

### 2. `App.tsx`
- **`handleFileUpload`** — agora lê com `XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", blankrows: false })`, produzindo matriz. Filtra reservas de 2026 com `headerMap` (sem depender de `getField`). Preserva a linha de cabeçalho no array filtrado.
- **`confirmImport`** — segmenta as linhas por mês via `headerMap`, e para cada mês envia `[headerRow, ...linhasDoMês]` ao backend.
- Removido o import não utilizado de `getField`.
- Adicionado import de `FinancialData` (corrigindo um erro pré-existente).

### 3. `services/dataService.ts` — `processReservations`
- Anotação explícita de retorno `Reservation | null` no `.map(...)` para o type predicate `(r): r is Reservation` aceitar o opcional `confirmationCode`.

## Itens preservados (intactos)
- `ManualDepositModal` e fluxo de depósito manual.
- `NfseControlReport`, `FiscalReport`, `dismissedAutoMatches`, undo de auto-conciliação.
- `getField` permanece exportado em `utils/helpers.ts` (não é mais usado no fluxo de importação, mas pode ser útil em outros pontos).

## Validação
- `vite build` → ✅ sucesso
- `tsc --noEmit` → 4 erros pré-existentes (Chart.js em Dashboard.tsx e FinancialReport.tsx), nenhum introduzido por esta mudança.
