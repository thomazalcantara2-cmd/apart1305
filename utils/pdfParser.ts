
import * as pdfjsLib from 'pdfjs-dist';

// Define the worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

// Keywords to filter for (as per user request)
const TARGET_KEYWORDS = [
    "TRANSFERÊNCIA A CRÉDITO VIA PIX - BANCO INTER",
    "TED RECEBIDA - DECOLAR.COM",
    "TED RECEBIDA - BOOKING.COM",
    "TRANSFERÊNCIA A CRÉDITO VIA PIX - BOOKING.COM",
    "PIX RECEBIDO DE BANCO INTER SA",
    "TED RECEBIDA DE BOOKING.COM BRASIL SERVICOS DE"
];

/**
 * Maps a free-form description text (already uppercased) to one of the standardized
 * keyword names used elsewhere in the system (reconciliation, deposits sheet, etc.).
 * Returns '' when no rule matches.
 */
const mapDescriptionToKeyword = (upperRowText: string): string => {
    let matchedKeyword: string | undefined = TARGET_KEYWORDS.find(k => upperRowText.includes(k));

    // Map specific variations to standard names
    if (matchedKeyword === "PIX RECEBIDO DE BANCO INTER SA") {
        matchedKeyword = "TRANSFERÊNCIA A CRÉDITO VIA PIX - BANCO INTER";
    } else if (matchedKeyword === "TED RECEBIDA DE BOOKING.COM BRASIL SERVICOS DE") {
        matchedKeyword = "TED RECEBIDA - BOOKING.COM";
    }

    // Fallback for partial matches or specific combinations if the exact long string isn't found
    if (!matchedKeyword) {
        // BTG Pactual format: "Pix recebido de BANCO INTER SA ... Mensagem - Pagamento Airbnb"
        if (upperRowText.includes("PIX RECEBIDO DE BANCO INTER SA") || (upperRowText.includes("BANCO INTER") && upperRowText.includes("PIX"))) {
            matchedKeyword = "TRANSFERÊNCIA A CRÉDITO VIA PIX - BANCO INTER";
        }
        // BTG Pactual format: "TED recebida de BOOKING.COM BRASIL SERVICOS DE RESERVA DE HOTEIS L"
        else if (upperRowText.includes("TED RECEBIDA DE BOOKING.COM BRASIL SERVICOS DE") || (upperRowText.includes("BOOKING") && upperRowText.includes("TED"))) {
            matchedKeyword = "TED RECEBIDA - BOOKING.COM";
        }
        // BTG / Inter: a generic "Pagamento Airbnb" message (without 'PIX' or 'BANCO INTER' on the same line)
        else if (upperRowText.includes("PAGAMENTO AIRBNB") || upperRowText.includes("PIX AIRBNB")) {
            matchedKeyword = "TRANSFERÊNCIA A CRÉDITO VIA PIX - BANCO INTER";
        }
        // Check specifically for the variation "BOOKING COM" (no dot) which is common in some bank statements
        else if (upperRowText.includes("BOOKING COM") && upperRowText.includes("PIX")) {
             matchedKeyword = "TRANSFERÊNCIA A CRÉDITO VIA PIX - BOOKING.COM";
        }
        else if (upperRowText.includes("DECOLAR") && (upperRowText.includes("TED") || upperRowText.includes("CREDITO") || upperRowText.includes("CRÉDITO"))) {
            matchedKeyword = "TED RECEBIDA - DECOLAR.COM";
        }
        // General loose check for Booking PIX
        else if (upperRowText.includes("BOOKING") && upperRowText.includes("PIX")) {
             matchedKeyword = "TRANSFERÊNCIA A CRÉDITO VIA PIX - BOOKING.COM";
        }
    }

    return matchedKeyword || '';
};

/**
 * Detects whether a page looks like a BTG Pactual statement.
 * BTG statements use a multi-line layout per transaction where the description
 * spans 2–3 lines and the date sits on the middle/anchor line together with the
 * "Entradas / Saídas" value and the running balance.
 */
const isBtgPactualLayout = (allRowsText: string): boolean => {
    const u = allRowsText.toUpperCase();
    if (u.includes("BTG PACTUAL")) return true;
    if (u.includes("ENTRADAS / SAÍDAS (R$)") && u.includes("SALDO (R$)") && u.includes("DATA LANÇAMENTO")) return true;
    return false;
};

/**
 * Parses a BTG Pactual–style page. Each lançamento is an "anchor" row containing
 * the date, plus 1–2 adjacent rows (above/below) without their own date that
 * complete the description. The transaction value is the **penultimate** currency
 * token on the anchor row (last token = running balance, which is discarded).
 */
const parseBtgRows = (
    rows: { y: number, text: string }[],
    extractedRows: any[][],
    seenTransactions: Set<string>
) => {
    const dateRe = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
    const Y_TOLERANCE = 30; // pixels; sub-lines of one block are ~13–15px apart

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const dateMatch = row.text.match(dateRe);
        if (!dateMatch) continue;

        const dateStr = dateMatch[0];
        const upperAnchor = row.text.toUpperCase();

        // Skip non-transaction anchor rows
        if (upperAnchor.includes("SALDO DE ABERTURA") || upperAnchor.includes("SALDO DE FECHAMENTO")) continue;
        if (upperAnchor.includes("PERÍODO DO EXTRATO") || upperAnchor.includes("PDF GERADO EM")) continue;

        // Aggregate surrounding lines (no date) within Y_TOLERANCE on each side
        const parts: string[] = [row.text];
        for (let k = i - 1; k >= 0 && k >= i - 2; k--) {
            const prev = rows[k];
            if (Math.abs(prev.y - row.y) > Y_TOLERANCE) break;
            if (dateRe.test(prev.text)) break;
            const u = prev.text.toUpperCase();
            if (u.includes("SALDO DE ABERTURA") || u.includes("SALDO DE FECHAMENTO") || u.includes("DATA LANÇAMENTO")) break;
            parts.unshift(prev.text);
        }
        for (let k = i + 1; k < rows.length && k <= i + 2; k++) {
            const next = rows[k];
            if (Math.abs(next.y - row.y) > Y_TOLERANCE) break;
            if (dateRe.test(next.text)) break;
            const u = next.text.toUpperCase();
            if (u.includes("SALDO DE ABERTURA") || u.includes("SALDO DE FECHAMENTO") || u.includes("FALE COM NOSSA CENTRAL")) break;
            parts.push(next.text);
        }

        const aggregated = parts.join(' ').replace(/\s+/g, ' ').trim();
        const upperAggregated = aggregated.toUpperCase();

        const matchedKeyword = mapDescriptionToKeyword(upperAggregated);
        if (!matchedKeyword) continue;

        // Extract value from the anchor row: penultimate currency token (last = saldo).
        // BTG numbers look like "2.236,88" / "23.215,48" / "986,28" — no C/D suffixes.
        const currencyMatches = row.text.match(/-?[\d.]+,\d{2}/g);
        if (!currencyMatches || currencyMatches.length === 0) continue;

        let valueStr = '';
        if (currencyMatches.length >= 2) {
            valueStr = currencyMatches[currencyMatches.length - 2];
        } else {
            valueStr = currencyMatches[0];
        }

        // Skip negative values (saídas) — only entradas matter
        if (valueStr.startsWith('-')) continue;

        const [day, month, year] = dateStr.split('/');
        const isoDate = `${year}-${month}-${day}`;
        const numericValue = parseFloat(valueStr.replace(/\./g, '').replace(',', '.'));
        if (isNaN(numericValue) || numericValue <= 0) continue;

        const uniqueKey = `${isoDate}|${matchedKeyword}|${numericValue}`;
        if (seenTransactions.has(uniqueKey)) continue;
        seenTransactions.add(uniqueKey);
        extractedRows.push([isoDate, matchedKeyword, numericValue]);
    }
};

export const extractDataFromPDF = async (file: File): Promise<any[][]> => {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const totalPages = pdf.numPages;
        const extractedRows: any[][] = [];
        const seenTransactions = new Set<string>();

        // Header row for the output (matches expected format for "Extrato" tab)
        extractedRows.push(['Data', 'Descrição', 'Valor']);

        for (let i = 1; i <= totalPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const items = textContent.items as any[];

            // 1. Group text items by Y coordinate (Row detection)
            const rows: { y: number, items: any[] }[] = [];
            const TOLERANCE = 5;

            items.sort((a, b) => b.transform[5] - a.transform[5]);

            for (const item of items) {
                if (!item.str || item.str.trim() === '') continue;
                const y = item.transform[5];
                const existingRow = rows.find(r => Math.abs(r.y - y) <= TOLERANCE);
                if (existingRow) {
                    existingRow.items.push(item);
                } else {
                    rows.push({ y, items: [item] });
                }
            }

            // Build a flat array of {y, text} rows (already sorted top-to-bottom)
            const flatRows = rows.map(r => {
                r.items.sort((a, b) => a.transform[4] - b.transform[4]);
                const text = r.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
                return { y: r.y, text };
            });

            // Decide layout: BTG (multi-line description) vs legacy (single-line)
            const fullPageText = flatRows.map(r => r.text).join('\n');

            if (isBtgPactualLayout(fullPageText)) {
                parseBtgRows(flatRows, extractedRows, seenTransactions);
                continue;
            }

            // ---- LEGACY single-line layout (Bradesco/etc.): unchanged behavior ----
            for (const row of flatRows) {
                const rowText = row.text;
                const upperRowText = rowText.toUpperCase();

                const matchedKeyword = mapDescriptionToKeyword(upperRowText);

                if (matchedKeyword) {
                    const dateMatch = rowText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                    const dateStr = dateMatch ? dateMatch[0] : null;
                    if (!dateStr) continue;

                    const currencyMatches = rowText.match(/-?[\d.]*,\d{2}[CD]?/g);

                    let valueStr = '';
                    if (currencyMatches && currencyMatches.length > 0) {
                        if (currencyMatches.length >= 2) {
                            valueStr = currencyMatches[currencyMatches.length - 2];
                        } else {
                            valueStr = currencyMatches[0];
                        }
                    }

                    if (dateStr && valueStr) {
                        if (valueStr.startsWith('-') || valueStr.endsWith('D')) {
                            continue;
                        }
                        valueStr = valueStr.replace(/[CD]/g, '').trim();
                        const [day, month, year] = dateStr.split('/');
                        const isoDate = `${year}-${month}-${day}`;
                        const numericValue = parseFloat(valueStr.replace(/\./g, '').replace(',', '.'));

                        if (!isNaN(numericValue)) {
                            const uniqueKey = `${isoDate}|${matchedKeyword}|${numericValue}`;
                            if (!seenTransactions.has(uniqueKey)) {
                                seenTransactions.add(uniqueKey);
                                extractedRows.push([isoDate, matchedKeyword, numericValue]);
                            }
                        }
                    }
                }
            }
        }

        return extractedRows;

    } catch (error) {
        console.error("Error parsing PDF:", error);
        throw new Error("Falha ao processar o arquivo PDF. Verifique se é um extrato válido.");
    }
};
