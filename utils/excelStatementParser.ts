declare const XLSX: any;

export const extractDataFromExcelStatement = async (file: File): Promise<any[][]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                const sheetAsArray: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
                
                const extractedRows: any[][] = [];
                extractedRows.push(['Data', 'Descrição', 'Valor']);
                
                // Find header row indices
                let headerRowIndex = -1;
                let dateColIndex = -1;
                let descColIndex = -1;
                let entradasSaidasColIndex = -1;
                let valueColIndex = -1;
                let saldoColIndex = -1;
                
                for (let i = 0; i < sheetAsArray.length; i++) {
                    const row = sheetAsArray[i];
                    // Scan a single row looking for header cells. We only commit the indices
                    // (and exit the outer loop) once we find a row that contains BOTH the date
                    // and description headers — that's the real header row, not a preamble line.
                    let localDate = -1, localDesc = -1, localEntradas = -1, localValor = -1, localSaldo = -1;
                    for (let j = 0; j < row.length; j++) {
                        const cellValue = String(row[j]).toLowerCase().trim();
                        if (cellValue.includes('data')) localDate = j;
                        if (cellValue.includes('descrição do lançamento') || cellValue.includes('historico') || cellValue.includes('descrição')) localDesc = j;
                        if (cellValue.includes('entradas / saídas (r$)') || cellValue.includes('entradas / saídas') || cellValue.includes('entradas/saídas')) localEntradas = j;
                        if (cellValue.includes('valor (r$)') || cellValue === 'valor') localValor = j;
                        // BTG-style header: "Saldo (R$)" column (the running balance — we discard it,
                        // but its presence is a strong signal for the multi-line description layout).
                        if (cellValue === 'saldo (r$)' || cellValue === 'saldo' || cellValue.includes('saldo (r$)')) localSaldo = j;
                    }
                    if (localDate !== -1 && localDesc !== -1) {
                        headerRowIndex = i;
                        dateColIndex = localDate;
                        descColIndex = localDesc;
                        entradasSaidasColIndex = localEntradas;
                        valueColIndex = localValor;
                        saldoColIndex = localSaldo;
                        break;
                    }
                }
                
                if (headerRowIndex === -1) {
                    throw new Error("Não foi possível encontrar o cabeçalho do extrato (Data, Descrição).");
                }
                
                // BTG-style spreadsheets sometimes split the description across multiple rows
                // (date is filled only on the anchor row; the surrounding rows hold extra
                // description text in the description column but leave the date column empty).
                // When we detect a "Saldo (R$)" column at the header, we activate description
                // aggregation: for each anchor row with a date, merge text from up to 2 rows
                // above and 2 rows below whose date cell is empty.
                const isBtgLayout = saldoColIndex !== -1;
                
                const getDescAt = (rowIdx: number): string => {
                    if (rowIdx <= headerRowIndex || rowIdx >= sheetAsArray.length) return '';
                    const r = sheetAsArray[rowIdx];
                    if (!r) return '';
                    return String(r[descColIndex] || '').trim();
                };
                const hasDateAt = (rowIdx: number): boolean => {
                    if (rowIdx <= headerRowIndex || rowIdx >= sheetAsArray.length) return false;
                    const r = sheetAsArray[rowIdx];
                    if (!r) return false;
                    const dv = r[dateColIndex];
                    if (dv instanceof Date) return true;
                    const s = String(dv || '').trim();
                    if (!s) return false;
                    return /(\d{2})\/(\d{2})\/(\d{4})/.test(s) || /(\d{4})-(\d{2})-(\d{2})/.test(s);
                };
                
                const seenTransactions = new Set<string>();
                
                for (let i = headerRowIndex + 1; i < sheetAsArray.length; i++) {
                    const row = sheetAsArray[i];
                    if (!row || row.length === 0) continue;
                    
                    const dateVal = row[dateColIndex];
                    let descVal = String(row[descColIndex] || '').trim();
                    
                    if (!dateVal || !descVal) continue;
                    
                    // BTG layout: pull in adjacent description-only rows (no date) to reconstruct
                    // the full description for this lançamento.
                    if (isBtgLayout) {
                        const parts: string[] = [descVal];
                        for (let k = i - 1; k >= headerRowIndex + 1 && k >= i - 2; k--) {
                            if (hasDateAt(k)) break;
                            const extra = getDescAt(k);
                            if (!extra) break;
                            parts.unshift(extra);
                        }
                        for (let k = i + 1; k < sheetAsArray.length && k <= i + 2; k++) {
                            if (hasDateAt(k)) break;
                            const extra = getDescAt(k);
                            if (!extra) break;
                            parts.push(extra);
                        }
                        descVal = parts.join(' ').replace(/\s+/g, ' ').trim();
                    } else {
                        // Even in legacy layouts the description cell may contain embedded newlines —
                        // normalize whitespace so .includes() matches work reliably.
                        descVal = descVal.replace(/\s+/g, ' ').trim();
                    }
                    
                    let isoDate = '';
                    if (dateVal instanceof Date) {
                        isoDate = dateVal.toISOString().split('T')[0];
                    } else {
                        // Try to parse DD/MM/YYYY
                        const dateMatch = String(dateVal).match(/(\d{2})\/(\d{2})\/(\d{4})/);
                        if (dateMatch) {
                            isoDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
                        } else {
                            // Try YYYY-MM-DD
                            const isoMatch = String(dateVal).match(/(\d{4})-(\d{2})-(\d{2})/);
                            if (isoMatch) {
                                isoDate = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
                            }
                        }
                    }
                    
                    if (!isoDate) continue;
                    
                    const upperDesc = descVal.toUpperCase();
                    
                    let matchedKeyword = '';
                    
                    if (upperDesc.includes("PIX RECEBIDO DE BANCO INTER SA")) {
                        matchedKeyword = "TRANSFERÊNCIA A CRÉDITO VIA PIX - BANCO INTER";
                    } else if (upperDesc.includes("TRANSFERÊNCIA A CRÉDITO VIA PIX - BANCO INTER")) {
                        matchedKeyword = "TRANSFERÊNCIA A CRÉDITO VIA PIX - BANCO INTER";
                    } else if (upperDesc.includes("TED RECEBIDA - DECOLAR.COM")) {
                        matchedKeyword = "TED RECEBIDA - DECOLAR.COM";
                    } else if (upperDesc.includes("TED RECEBIDA - BOOKING.COM")) {
                        matchedKeyword = "TED RECEBIDA - BOOKING.COM";
                    } else if (upperDesc.includes("TED RECEBIDA DE BOOKING.COM BRASIL SERVICOS")) {
                        // BTG Pactual: "TED recebida de BOOKING.COM BRASIL SERVICOS DE RESERVA DE HOTEIS L"
                        matchedKeyword = "TED RECEBIDA - BOOKING.COM";
                    } else if (upperDesc.includes("TRANSFERÊNCIA A CRÉDITO VIA PIX - BOOKING.COM")) {
                        matchedKeyword = "TRANSFERÊNCIA A CRÉDITO VIA PIX - BOOKING.COM";
                    } else if (upperDesc.includes("BOOKING COM") && upperDesc.includes("PIX")) {
                        matchedKeyword = "TRANSFERÊNCIA A CRÉDITO VIA PIX - BOOKING.COM";
                    } else if (upperDesc.includes("PAGAMENTO AIRBNB") || upperDesc.includes("PIX AIRBNB")) {
                        // BTG Pactual / Inter: "Mensagem - Pagamento Airbnb"
                        matchedKeyword = "TRANSFERÊNCIA A CRÉDITO VIA PIX - BANCO INTER";
                    } else if (upperDesc.includes("DECOLAR") && (upperDesc.includes("TED") || upperDesc.includes("CREDITO") || upperDesc.includes("CRÉDITO"))) {
                        matchedKeyword = "TED RECEBIDA - DECOLAR.COM";
                    } else if (upperDesc.includes("BOOKING") && upperDesc.includes("PIX")) {
                        matchedKeyword = "TRANSFERÊNCIA A CRÉDITO VIA PIX - BOOKING.COM";
                    } else if (upperDesc.includes("BOOKING") && upperDesc.includes("TED")) {
                        matchedKeyword = "TED RECEBIDA - BOOKING.COM";
                    }
                    
                    if (matchedKeyword) {
                        let numericValue = 0;
                        
                        // Helper: parse a cell value into a positive number.
                        const parseCell = (val: any): number => {
                            if (val === null || val === undefined || val === '') return NaN;
                            if (typeof val === 'number') return val;
                            const s = String(val).trim();
                            // Brazilian format: "1.234,56" → 1234.56. Also tolerates "R$ 1.234,56".
                            const cleaned = s.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
                            const parsed = parseFloat(cleaned);
                            return isNaN(parsed) ? NaN : parsed;
                        };
                        
                        // Column priority depends on which columns the statement actually has:
                        //  - Legacy "Bradesco-style": separate "Valor (R$)" column → use it.
                        //  - BTG-style: only "Entradas / Saídas (R$)" and "Saldo (R$)" → use Entradas/Saídas.
                        //  - User's original rule for Airbnb: always prefer "Entradas / Saídas (R$)"
                        //    when it exists, regardless of layout.
                        if (matchedKeyword === "TRANSFERÊNCIA A CRÉDITO VIA PIX - BANCO INTER" && entradasSaidasColIndex !== -1) {
                            const parsed = parseCell(row[entradasSaidasColIndex]);
                            if (!isNaN(parsed)) numericValue = parsed;
                        } else if (valueColIndex !== -1) {
                            // Legacy layout has a dedicated "Valor (R$)" column
                            const parsed = parseCell(row[valueColIndex]);
                            if (!isNaN(parsed)) numericValue = parsed;
                        } else if (entradasSaidasColIndex !== -1) {
                            // BTG layout (or any layout without "Valor"): use Entradas / Saídas
                            const parsed = parseCell(row[entradasSaidasColIndex]);
                            if (!isNaN(parsed)) numericValue = parsed;
                        }
                        
                        if (numericValue > 0) {
                            const uniqueKey = `${isoDate}|${matchedKeyword}|${numericValue}`;
                            if (!seenTransactions.has(uniqueKey)) {
                                seenTransactions.add(uniqueKey);
                                extractedRows.push([isoDate, matchedKeyword, numericValue]);
                            }
                        }
                    }
                }
                
                resolve(extractedRows);
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsBinaryString(file);
    });
};
