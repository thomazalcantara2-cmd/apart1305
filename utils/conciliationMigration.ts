/**
 * conciliationMigration.ts
 *
 * Quando o usuário reimporta a planilha de reservas ou adiciona/edita depósitos,
 * a função `processReservations` / `processDeposits` regera os IDs estáveis
 * (RES-..., DEP-...) a partir do conteúdo das linhas. Em alguns cenários esses
 * IDs **mudam** de uma importação para outra:
 *
 *  - Reservas: o `guestSlug` é gerado por `slugify`, que remove tudo que não é
 *    `[A-Za-z0-9_-]`. Isso significa que caracteres acentuados são apagados, e
 *    "AGUSTÍN" vira "AGUSTN" — se a plataforma reexportar a reserva com a grafia
 *    "AGUSTIN" (sem acento) o slug muda e o ID quebra. O mesmo vale para
 *    pequenas variações de pontuação ou de comprimento do nome (o slug é
 *    cortado em 15 caracteres).
 *
 *  - Depósitos: quando há dois ou mais lançamentos exatamente iguais no mesmo
 *    dia (mesma data + mesmo valor + mesma descrição — caso comum com Booking),
 *    o gerador acrescenta um sufixo de desempate `-2`, `-3`, ... Esse sufixo
 *    depende da **ordem** dos lançamentos no arquivo importado, o que torna o ID
 *    instável: ao reimportar com ordem diferente, ou inserir um novo depósito no
 *    meio, o que era DEP-...-2 pode virar DEP-...-3 e vice-versa.
 *
 * Resultado prático: as conciliações manuais salvas no Google Sheets continuam
 * apontando para IDs antigos que já não existem no conjunto atual, e a UI passa
 * a tratar essas reservas/depósitos como "pendentes".
 *
 * A solução implementada aqui é uma **remapeação tolerante** que roda em
 * memória logo após o `processReservations`/`processDeposits` e antes de
 * popular o estado React. Para cada `reservationId`/`depositId` que não existe
 * mais, buscamos o melhor candidato pelo conteúdo (assinatura) e substituímos.
 * Cada candidato encontrado é "consumido" — não pode ser usado por duas
 * conciliações diferentes — o que protege contra colisões em casos extremos.
 *
 * A função preserva conciliações cujos IDs ainda batem (nada muda) e devolve
 * um flag `changed` para que o caller decida se vale a pena persistir a versão
 * corrigida no backend.
 */

import { Reservation, BankDeposit, ManualConciliation, DismissedAutoMatch } from '../types';

/**
 * Normaliza um nome de hóspede para comparação difusa entre importações:
 *  - Remove diacríticos (acentos, til, cedilha) via NFD + filtro de combining marks
 *  - Caixa baixa
 *  - Remove qualquer caractere que não seja letra ASCII ou dígito
 *  - Sem corte de comprimento (diferente do slugify do dataService) para
 *    maximizar a chance de match difuso.
 */
const normalizeGuestName = (name: string): string => {
    if (!name) return '';
    return name
        .toString()
        .normalize('NFD')
        // eslint-disable-next-line no-misleading-character-class
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
};

const dateToISO = (d: Date | string): string => {
    if (d instanceof Date) {
        if (isNaN(d.getTime())) return '';
        return d.toISOString().split('T')[0];
    }
    const m = String(d).match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};

/**
 * Assinatura de uma reserva: combinação de flat + data de check-in + nome
 * normalizado. Resiste a variações de acentuação e comprimento no nome do
 * hóspede, e mantém precisão suficiente (datas + flat) para distinguir reservas
 * diferentes do mesmo hóspede em viagens distintas.
 */
const reservationSignature = (r: Reservation): string => {
    return `${r.flat}|${dateToISO(r.checkIn)}|${normalizeGuestName(r.guestName)}`;
};

/**
 * Assinatura de um depósito: data ISO + valor em centavos + descrição
 * normalizada. Dois depósitos com a mesma assinatura são funcionalmente
 * intercambiáveis — qualquer um deles satisfaz a conciliação manual que
 * apontava para um ID antigo do mesmo grupo.
 */
const depositSignature = (d: BankDeposit): string => {
    const dateISO = dateToISO(d.date);
    const cents = Math.round(d.amount * 100);
    const descNorm = (d.description || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .slice(0, 30); // mais espaço que o slugify(15) para reduzir colisões espúrias
    return `${dateISO}|${cents}|${descNorm}`;
};

/**
 * Resolve um ID antigo contra o conjunto atual.
 * - Se o ID continua válido no conjunto atual: retorna o próprio ID e marca
 *   o registro como consumido.
 * - Senão, busca o primeiro registro do mesmo "grupo" (mesma assinatura) que
 *   ainda não foi consumido por outra remapeação. Se encontrar, retorna o ID
 *   novo e marca-o como consumido.
 * - Se nada bate, retorna null (a entrada será descartada).
 */
const resolveById = <T extends { id: string }>(
    oldId: string,
    currentById: Map<string, T>,
    bySignature: Map<string, T[]>,
    consumed: Set<string>,
    oldSignatureLookup: ((id: string) => string | null) | null,
): string | null => {
    // Match direto
    if (currentById.has(oldId) && !consumed.has(oldId)) {
        consumed.add(oldId);
        return oldId;
    }

    // Match difuso por assinatura. Como não temos o registro antigo (só o ID
    // antigo perdido), tentamos extrair a assinatura do próprio ID quando
    // possível — IDs DEP-... carregam data e valor diretamente; IDs RES-...
    // carregam flat e data de check-in.
    if (oldSignatureLookup) {
        const sigPrefix = oldSignatureLookup(oldId);
        if (sigPrefix) {
            for (const [sig, candidates] of bySignature.entries()) {
                if (sig.startsWith(sigPrefix)) {
                    for (const cand of candidates) {
                        if (!consumed.has(cand.id)) {
                            consumed.add(cand.id);
                            return cand.id;
                        }
                    }
                }
            }
        }
    }
    return null;
};

/**
 * Extrai um prefixo de assinatura a partir de um ID `RES-{flat}-{YYYYMMDD}-{guestSlug}`.
 * Retorna `"{flat}|{YYYY-MM-DD}|"` para fazer match parcial contra a tabela
 * de assinaturas atuais (`{flat}|{YYYY-MM-DD}|{guestNorm}`).
 */
const reservationSignaturePrefixFromOldId = (oldId: string): string | null => {
    // Padrão: RES-{flat}-{YYYYMMDD}-{guestSlug}
    const m = oldId.match(/^RES-([^-]+)-(\d{4})(\d{2})(\d{2})-/);
    if (!m) return null;
    const [, flat, y, mo, d] = m;
    return `${flat}|${y}-${mo}-${d}|`;
};

/**
 * Extrai um prefixo de assinatura a partir de um ID
 * `DEP-{YYYYMMDD}-{amountCents}-{descSlug}[-N]`.
 * Retorna `"{YYYY-MM-DD}|{cents}|"`.
 */
const depositSignaturePrefixFromOldId = (oldId: string): string | null => {
    // Padrão: DEP-{YYYYMMDD}-{cents}-{descSlug}[-N]
    const m = oldId.match(/^DEP-(\d{4})(\d{2})(\d{2})-(\d+)-/);
    if (!m) return null;
    const [, y, mo, d, cents] = m;
    return `${y}-${mo}-${d}|${cents}|`;
};

interface RemapResult<T> {
    items: T[];
    changed: boolean;
    /** Quantos IDs foram remapeados (substituídos) ao todo. */
    remappedCount: number;
    /** Quantas conciliações ficaram completamente órfãs e foram descartadas. */
    droppedCount: number;
}

/**
 * Remapeia uma lista de ManualConciliation contra os conjuntos atuais de
 * reservas e depósitos. Conciliações que não conseguem ser resolvidas (todos
 * os reservationIds OU todos os depositIds ficaram órfãos) são descartadas.
 */
export const remapManualConciliations = (
    conciliations: ManualConciliation[],
    reservations: Reservation[],
    deposits: BankDeposit[],
): RemapResult<ManualConciliation> => {
    const resById = new Map(reservations.map(r => [r.id, r]));
    const depById = new Map(deposits.map(d => [d.id, d]));

    const resBySig = new Map<string, Reservation[]>();
    for (const r of reservations) {
        const sig = reservationSignature(r);
        const arr = resBySig.get(sig);
        if (arr) arr.push(r);
        else resBySig.set(sig, [r]);
    }

    const depBySig = new Map<string, BankDeposit[]>();
    for (const d of deposits) {
        const sig = depositSignature(d);
        const arr = depBySig.get(sig);
        if (arr) arr.push(d);
        else depBySig.set(sig, [d]);
    }

    // "Consumido" é por-conciliação? Não — é GLOBAL dentro da remapeação, para
    // evitar que duas conciliações antigas mapeiem para o mesmo registro atual.
    // Direct hits (ID antigo == ID novo) também consomem, pois é o caminho ideal.
    const consumedRes = new Set<string>();
    const consumedDep = new Set<string>();

    // Primeiro passe: aplicar todos os matches diretos para "reservar" os IDs
    // que claramente continuam válidos. Isso protege contra um match difuso
    // roubar um ID que pertence a outra conciliação que ainda funciona.
    for (const mc of conciliations) {
        for (const rid of mc.reservationIds) {
            if (resById.has(rid)) consumedRes.add(rid);
        }
        for (const did of mc.depositIds) {
            if (depById.has(did)) consumedDep.add(did);
        }
    }

    let totalRemapped = 0;
    let totalDropped = 0;
    let anyChange = false;
    const out: ManualConciliation[] = [];

    for (const mc of conciliations) {
        const newResIds: string[] = [];
        let mcRemapped = 0;
        for (const rid of mc.reservationIds) {
            if (resById.has(rid)) {
                // Já foi consumido no primeiro passe — apenas anote no resultado
                newResIds.push(rid);
            } else {
                const remapped = resolveById(
                    rid,
                    resById,
                    resBySig,
                    consumedRes,
                    reservationSignaturePrefixFromOldId,
                );
                if (remapped) {
                    newResIds.push(remapped);
                    mcRemapped++;
                }
                // Se não resolveu, a entrada some — esse hóspede provavelmente
                // foi removido da planilha (e a perda é correta).
            }
        }

        const newDepIds: string[] = [];
        for (const did of mc.depositIds) {
            if (depById.has(did)) {
                newDepIds.push(did);
            } else {
                const remapped = resolveById(
                    did,
                    depById,
                    depBySig,
                    consumedDep,
                    depositSignaturePrefixFromOldId,
                );
                if (remapped) {
                    newDepIds.push(remapped);
                    mcRemapped++;
                }
            }
        }

        // Conciliação é viável só se ambos os lados têm pelo menos um item.
        if (newResIds.length === 0 || newDepIds.length === 0) {
            totalDropped++;
            anyChange = true;
            continue;
        }

        if (mcRemapped > 0) {
            totalRemapped += mcRemapped;
            anyChange = true;
        }

        out.push({
            ...mc,
            reservationIds: newResIds,
            depositIds: newDepIds,
        });
    }

    return { items: out, changed: anyChange, remappedCount: totalRemapped, droppedCount: totalDropped };
};

/**
 * Mesmo princípio para DismissedAutoMatch. Aqui um item só é viável se o
 * `depositId` continua resolvendo e ao menos uma reserva também.
 */
export const remapDismissedAutoMatches = (
    dismissed: DismissedAutoMatch[],
    reservations: Reservation[],
    deposits: BankDeposit[],
): RemapResult<DismissedAutoMatch> => {
    const resById = new Map(reservations.map(r => [r.id, r]));
    const depById = new Map(deposits.map(d => [d.id, d]));

    const resBySig = new Map<string, Reservation[]>();
    for (const r of reservations) {
        const sig = reservationSignature(r);
        const arr = resBySig.get(sig);
        if (arr) arr.push(r);
        else resBySig.set(sig, [r]);
    }
    const depBySig = new Map<string, BankDeposit[]>();
    for (const d of deposits) {
        const sig = depositSignature(d);
        const arr = depBySig.get(sig);
        if (arr) arr.push(d);
        else depBySig.set(sig, [d]);
    }

    const consumedRes = new Set<string>();
    const consumedDep = new Set<string>();

    for (const dm of dismissed) {
        for (const rid of dm.reservationIds) if (resById.has(rid)) consumedRes.add(rid);
        if (depById.has(dm.depositId)) consumedDep.add(dm.depositId);
    }

    let totalRemapped = 0;
    let totalDropped = 0;
    let anyChange = false;
    const out: DismissedAutoMatch[] = [];

    for (const dm of dismissed) {
        let depId: string | null;
        if (depById.has(dm.depositId)) {
            depId = dm.depositId;
        } else {
            depId = resolveById(dm.depositId, depById, depBySig, consumedDep, depositSignaturePrefixFromOldId);
            if (depId) totalRemapped++;
        }
        if (!depId) {
            totalDropped++;
            anyChange = true;
            continue;
        }

        const newResIds: string[] = [];
        for (const rid of dm.reservationIds) {
            if (resById.has(rid)) {
                newResIds.push(rid);
            } else {
                const remapped = resolveById(rid, resById, resBySig, consumedRes, reservationSignaturePrefixFromOldId);
                if (remapped) {
                    newResIds.push(remapped);
                    totalRemapped++;
                }
            }
        }
        if (newResIds.length === 0) {
            totalDropped++;
            anyChange = true;
            continue;
        }
        if (depId !== dm.depositId || newResIds.length !== dm.reservationIds.length) {
            anyChange = true;
        }
        out.push({ ...dm, depositId: depId, reservationIds: newResIds });
    }

    return { items: out, changed: anyChange, remappedCount: totalRemapped, droppedCount: totalDropped };
};
