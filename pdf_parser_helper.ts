import { extractText } from 'unpdf';

// Interface matching ExtractionField
interface ExtractionField {
  id: string;
  name: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'currency';
  description: string;
  required: boolean;
}

/**
 * Standardizes dynamic Date strings from Brazilian Format (DD/MM/YYYY) to Global Format (YYYY-MM-DD)
 */
/**
 * Standardizes dynamic Date strings from any format (like YYYY-MM-DD or DD/MM/YYYY) to Brazilian Format (DD/MM/YYYY)
 */
export function standardizeDate(val: string): string {
  if (!val) return "";
  const cleaned = val.trim();

  // Case A: already DD/MM/YYYY
  const brMatch = cleaned.match(/\b([0-3]?[0-9])\/([0-1]?[0-9])\/([1-2][0-9]{3})\b/);
  if (brMatch) {
    const d = brMatch[1].padStart(2, '0');
    const m = brMatch[2].padStart(2, '0');
    const y = brMatch[3];
    return `${d}/${m}/${y}`;
  }

  // Case B: YYYY-MM-DD ISO date format
  const isoMatch = cleaned.match(/\b([1-2][0-9]{3})[-/]([0-1]?[0-9])[-/]([0-3]?[0-9])\b/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = isoMatch[2].padStart(2, '0');
    const d = isoMatch[3].padStart(2, '0');
    return `${d}/${m}/${y}`;
  }

  // Case C: Date with short year e.g., DD/MM/YY
  const shortYearParts = cleaned.match(/\b([0-3]?[0-9])\/([0-1]?[0-9])\/([0-9]{2})\b/);
  if (shortYearParts) {
    const d = shortYearParts[1].padStart(2, '0');
    const m = shortYearParts[2].padStart(2, '0');
    const y = "20" + shortYearParts[3]; // Assume century 21
    return `${d}/${m}/${y}`;
  }

  return cleaned;
}

/**
 * Clears and standardizes currency values (e.g. "R$ 1.250,55" -> "1250.55")
 */
function standardizeCurrency(val: string): string {
  let cleaned = val.replace(/R\$/gi, '').trim();
  // If format is Brazilian (e.g., 1.500,45)
  if (cleaned.includes(',') && cleaned.includes('.')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    // Single comma, e.g., "1500,45"
    cleaned = cleaned.replace(',', '.');
  }
  // Remove non-numeric/non-dot chars
  cleaned = cleaned.replace(/[^0-9.]/g, '');
  return cleaned;
}

/**
 * Helper to determine if a parsed value is likely a unit tariff/rate rather than consumption (kWh).
 * A unit tariff is usually < 5.0 and is a fractional number (e.g. 0.39284, 0.2831, 1.442).
 * Monthly electrical energy consumption in kWh is always a whole number (or integer) when parsed and normalized.
 */
function isProbablyTariff(valStr: string): boolean {
  if (!valStr) return false;
  let cleaned = valStr.trim();
  if (cleaned.includes(',') && cleaned.includes('.')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  } else if (cleaned.includes('.')) {
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (dotCount > 1) {
      cleaned = cleaned.replace(/\./g, '');
    } else {
      const parts = cleaned.split('.');
      if (parts[1] && parts[1].length === 3) {
        cleaned = cleaned.replace(/\./g, '');
      }
    }
  }
  cleaned = cleaned.replace(/[^0-9.]/g, '');
  const floatVal = parseFloat(cleaned);
  if (isNaN(floatVal)) return false;
  
  // A tariff unit price is typically a fractional float less than 5.0 (like 0.3928, 0.2831, 0.72)
  // Monthly electricity consumption (kWh) is never a fractional value less than 5.
  if (floatVal < 5.0 && floatVal % 1 !== 0) {
    return true;
  }
  return false;
}

/**
 * Aligns labels and values that are stacked vertically across columns.
 * Finds all matched occurrences of the pattern on the value line, and matches the one closest
 * horizontally to the position of the keyword on the keyword line.
 */
function findClosestValueByCoordinates(keywordLine: string, valueLine: string, keyword: string, pattern: RegExp): string {
  const kwIndex = keywordLine.toLowerCase().indexOf(keyword.toLowerCase());
  if (kwIndex === -1) return "";

  const matches: { value: string; index: number }[] = [];
  // Build a global RegExp from the pattern to fetch all occurrences
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  const regex = new RegExp(pattern.source, flags);
  
  let m;
  // Reset regex index to perform clean execution
  regex.lastIndex = 0;
  while ((m = regex.exec(valueLine)) !== null) {
    matches.push({
      value: (m[1] || m[0]).trim(),
      index: m.index
    });
  }

  if (matches.length === 0) return "";
  
  // Find the match closest to kwIndex
  let bestMatch = matches[0];
  let minDiff = Math.abs(bestMatch.index - kwIndex);

  for (let idx = 1; idx < matches.length; idx++) {
    const diff = Math.abs(matches[idx].index - kwIndex);
    if (diff < minDiff) {
      minDiff = diff;
      bestMatch = matches[idx];
    }
  }

  return bestMatch.value;
}

/**
 * Tries parsing digital text directly with deterministic regex matchers
 */
export function extractFieldsWithRegex(text: string, fields: ExtractionField[]): Record<string, any> {
  const result: Record<string, any> = {};

  // Clean and filter out sections that belong to MM Delivery cover sheets or delivery protocols
  let linesForClean = text.split('\n');
  let isInsideProtocol = false;
  const filteredLines = [];
  
  for (const line of linesForClean) {
    const lineUpper = line.toUpperCase();
    
    // Trigger protocol / cover sheet detection only on actual protocol title or tracking department phrases.
    // Extremely critical: NEVER include the customer name "MM Delivery" or variation in this check,
    // because that name is printed on the actual official invoices as the payer / client name!
    if (
      lineUpper.includes("PROTOCOLO DE ACOMPANHAMENTO") || 
      lineUpper.includes("DEPARTAMENTO DE COMPRAS") ||
      lineUpper.includes("PROTOCOLO DE ENTREGA") ||
      lineUpper.includes("PROTOCOLO DE RECEBIMENTO") ||
      lineUpper.includes("ACOMPANHAMENTO DE NF")
    ) {
      isInsideProtocol = true;
    }
    
    if (isInsideProtocol) {
      // If we are inside protocol but see a major concessionaire name or standard invoice phrase, we might have merged documents.
      // We check that this is not just the "Fornecedor: " line of the protocol.
      if (
        (
          lineUpper.includes("ENEL") || 
          lineUpper.includes("ELETROPAULO") || 
          lineUpper.includes("CPFL") || 
          lineUpper.includes("RGE") || 
          lineUpper.includes("COPEL") || 
          lineUpper.includes("CEMIG") || 
          lineUpper.includes("ENERGISA") || 
          lineUpper.includes("LIGHT") ||
          lineUpper.includes("NEOENERGIA") ||
          lineUpper.includes("ELEKTRO") ||
          lineUpper.includes("VALOR A PAGAR") ||
          lineUpper.includes("CHAVE DE ACESSO") ||
          lineUpper.includes("UNIDADE CONSUMIDORA") ||
          lineUpper.includes("Nº DA INSTALAÇÃO") ||
          lineUpper.includes("FATURA DE ENERGIA") ||
          lineUpper.includes("CONTA DE LUZ")
        ) && 
        !lineUpper.includes("FORNECEDOR:") && 
        !lineUpper.includes("FORNECEDOR :")
      ) {
        isInsideProtocol = false;
      }
    }
    
    if (!isInsideProtocol) {
      filteredLines.push(line);
    }
  }
  
  const originalText = text;
  text = filteredLines.join('\n');
  if (text.length !== originalText.length) {
    console.log(`[ProtocolFilter] Removido bloco de protocolo de acompanhamento. Tamanho reduzido de ${originalText.length} para ${text.length} caracteres.`);
  }

  // Log some text length for terminal insights
  console.log(`[RegexExtractor] Analisando texto extraído de ${text.length} caracteres...`);

  // General standard list of regex patterns for Portuguese invoices (NF-e, NFS-e, faturas, recibos)
  const regexes = {
    cnpj: /(?:CNPJ|C\.N\.P\.J\.?:?)\s*([0-9]{2}\.[0-9]{3}\.[0-9]{3}\/[0-9]{4}-[0-9]{2}|[0-9]{14})/i,
    valor_total: /(?:VALOR\s*TOTAL|TOTAL\s*DA\s*NOTA|VALOR\s*LÍQUIDO|VALOR\s*LIQUIDO|TOTAL\s*DO\s*SERVIÇO|VALOR\s*COBRADO|TOTAL|TOTAL\s*A\s*PAGAR|TOTAL\s*GERAL)\s*[:R\$\-]*\s*([0-9\. \t]+,[0-9]{2})/i,
    data_emissao: /(?:EMISSÃO|EMISSAO|GERAÇÃO|DATA|COMPETÊNCIA|EMITIDO\s*EM)[:\s\-]*([0-3][0-9]\/[0-1][0-9]\/[1-2][0-9]{3})/i,
    numero_nota: /(?:Número|Numero|No\.|N[oº]|NFS-e|Fatura|RPS|Série|Serie)\s*(?:da\s*Nota|da\s*Fatura|do\s*serviço|de\s*Controle|RPS)?\s*[:\s#\-]*\s*([0-9\.\-/]+)/i,
    emissor_nome: /(?:RAZÃO\s*SOCIAL|RAZAO\s*SOCIAL|PRESTADOR|EMISSOR|EMITENTE|NOME\s*DO\s*PRESTADOR|NOME\s*FANTASIA)[:\s]*([^\n\r]+)/i
  };

  const normalize = (s: string): string => {
    return s ? s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : "";
  };

  const normText = normalize(text);
  const lowerText = normText;
  const firstCnpjMatch = text.match(/([0-9]{2}\.[0-9]{3}\.[0-9]{3}\/[0-9]{4}-[0-9]{2})/);
  const generalDateMatches = text.match(/([0-3][0-9]\/[0-1][0-9]\/[1-2][0-9]{3})/g);

  // Pre-scan for common "Month + DueDate + Value" horizontal rows, extremely common in CPFL/Enel/Elektro bills
  let preScannedRef = "";
  let preScannedVenc = "";
  let preScannedValor = "";

  const monthMapLocal: Record<string, string> = {
    'jan': '01', 'fev': '02', 'mar': '03', 'abr': '04', 'mai': '05', 'jun': '06',
    'jul': '07', 'ago': '08', 'set': '09', 'out': '10', 'nov': '11', 'dez': '12',
    'janeiro': '01', 'fevereiro': '02', 'marco': '03', 'abril': '04',
    'maio': '05', 'junho': '06', 'julho': '07', 'agosto': '08', 'setembro': '09',
    'outubro': '10', 'novembro': '11', 'dezembro': '12'
  };

  const linesForPreScan = text.split('\n').map(l => l.trim());
  for (const line of linesForPreScan) {
    const normLine = normalize(line);
    // Look for e.g. "NOV / 2025" or "11 / 2025" or "NOV-25" (supporting spaces around separators)
    const monthRegex = new RegExp(`(?<![0-9/])\\b(${Object.keys(monthMapLocal).join('|')}|0[1-9]|1[0-2])\\s*[-/\\s]\\s*(20[2-3][0-9]|[0-9]{2})\\b(?![0-9/])`, 'i');
    const monthMatch = normLine.match(monthRegex);

    // Look for due date DD/MM/YYYY
    const dateMatch = line.match(/\b([0-3]?[0-9]\/[0-1]?[0-9]\/[1-2][0-9]{3})\b/);

    // Look for monetary value, e.g., R$ 457,96 or similar
    const priceMatch = line.match(/(?:R\$)\s*([0-9\.]+,[0-9]{2})/i) || line.match(/\b([0-9\.]+,[0-9]{2})\b/);

    if (monthMatch && dateMatch && priceMatch) {
      const mName = monthMatch[1].toLowerCase();
      const mNum = monthMapLocal[mName] || monthMatch[1].padStart(2, '0');
      let y = monthMatch[2];
      if (y.length === 2) y = '20' + y;
      
      preScannedRef = `${mNum}/${y}`;
      preScannedVenc = standardizeDate(dateMatch[1]);
      preScannedValor = priceMatch[1].trim();
      console.log(`[Pre-Scan Match] Encontrada linha de fatura tripla: Ref=${preScannedRef}, Venc=${preScannedVenc}, Valor=${preScannedValor}`);
      break;
    }
  }

  // Define normalized lines array for coordinates matching
  const lines = text.split('\n').map(l => normalize(l));
  
  fields.forEach(field => {
    const fn = field.name.toLowerCase();
    const fl = field.label.toLowerCase();
    let value = "";

    // A. EXPLICIT DETERMINISTIC OVERRIDES FOR ENERGY PRE-SET FIELDS
    
    // 1. Installation Number / UC
    if (fn.includes('instalacao') || fn.includes('instalação') || fl.includes('instalação') || fl.includes('instalacao') || fl.includes('unidade consumidora') || fl.includes('uc')) {
      const instTrueKeywords = [
        'instalacao / unidade consumidora', 'instalacao/unidade consumidora',
        'sua instalacao', 'no. instalacao', 'no. da instalacao', 'n° instalacao', 'nº instalacao',
        'cod. instalacao', 'codigo instalacao', 'codigo da instalacao',
        'codigo unico', 'unidade consumidora', 'instalacao', 'uc'
      ];
      
      const instFallbackKeywords = [
        'codigo do cliente', 'no do cliente', 'no. do cliente', 'nº do cliente',
        'seu numero', 'seu codigo', 'contrato', 'no. do contrato',
        'nº do contrato', 'numero do contrato', 'codigo de cliente', 'cod. cliente', 'codigo cliente'
      ];
      
      // A. Try exact line-level search first with true installation keywords on normText (no accents, lowercase)
      for (const kw of instTrueKeywords) {
        const regexVal = new RegExp(`${kw}\\s*[:\\- ]*\\s*([0-9][0-9\\.\\-/ led]{3,15}[0-9xX]?)`, 'i');
        const match = normText.match(regexVal);
        if (match) {
          const rawVal = match[1].trim();
          if ((rawVal.match(/[0-9]/g) || []).length >= 5) {
            value = rawVal;
            break;
          }
        }
      }

      // B. Line-by-line coordinate look-ahead with true installation keywords
      if (!value) {
        for (let i = 0; i < lines.length; i++) {
          const lineLower = lines[i]; // already normalized and lowercase!
          const matchedKw = instTrueKeywords.find(kw => {
            if (kw === 'uc') return /\buc\b/i.test(lineLower);
            return lineLower.includes(kw);
          });
          
          if (matchedKw) {
            // Check next line
            if (i + 1 < lines.length) {
              const matchedVal = findClosestValueByCoordinates(lines[i], lines[i+1], matchedKw, /\b([0-9][0-9.-]{3,15}[0-9xX]?)\b/i);
              if (matchedVal && (matchedVal.match(/[0-9]/g) || []).length >= 5) {
                value = matchedVal;
                break;
              }
            }
            // Check 2 lines ahead
            if (i + 2 < lines.length) {
              const matchedVal2 = findClosestValueByCoordinates(lines[i], lines[i+2], matchedKw, /\b([0-9][0-9.-]{3,15}[0-9xX]?)\b/i);
              if (matchedVal2 && (matchedVal2.match(/[0-9]/g) || []).length >= 5) {
                value = matchedVal2;
                break;
              }
            }
          }
        }
      }

      // C. Fallback line-level search with client/contract keywords on normText
      if (!value) {
        for (const kw of instFallbackKeywords) {
          const regexVal = new RegExp(`${kw}\\s*[:\\- ]*\\s*([0-9][0-9\\.\\-/]{3,15}[0-9xX]?)`, 'i');
          const match = normText.match(regexVal);
          if (match) {
            const rawVal = match[1].trim();
            if ((rawVal.match(/[0-9]/g) || []).length >= 5) {
              value = rawVal;
              break;
            }
          }
        }
      }

      // D. Fallback coordinate look-ahead with client/contract keywords
      if (!value) {
        for (let i = 0; i < lines.length; i++) {
          const lineLower = lines[i]; // already normalized & lowercase!
          const matchedKw = instFallbackKeywords.find(kw => lineLower.includes(kw));
          if (matchedKw) {
            if (i + 1 < lines.length) {
              const matchedVal = findClosestValueByCoordinates(lines[i], lines[i+1], matchedKw, /\b([0-9][0-9.-]{3,15}[0-9xX]?)\b/i);
              if (matchedVal && (matchedVal.match(/[0-9]/g) || []).length >= 5) {
                value = matchedVal;
                break;
              }
            }
            if (i + 2 < lines.length) {
              const matchedVal2 = findClosestValueByCoordinates(lines[i], lines[i+2], matchedKw, /\b([0-9][0-9.-]{3,15}[0-9xX]?)\b/i);
              if (matchedVal2 && (matchedVal2.match(/[0-9]/g) || []).length >= 5) {
                value = matchedVal2;
                break;
              }
            }
          }
        }
      }

      if (!value) {
        // Standalone number rule (looks for a line of exactly 7 to 11 digits near CNPJ or NOTA FISCAL or FATURA or EMISSÃO/EMISSAO)
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].match(/^\d{7,11}$/)) {
            const nearbyLines = lines.slice(Math.max(0, i - 4), Math.min(lines.length, i + 5));
            const nearText = nearbyLines.join('\n'); // already lowercase & normalized
            if (nearText.includes('cnpj') || nearText.includes('nota fiscal') || nearText.includes('fatura') || nearText.includes('emissao')) {
              value = lines[i];
              break;
            }
          }
        }
      }
    }
    // 2. Month Reference (Mês de referência)
    else if (fn.includes('mes_referencia') || fn.includes('mês_referencia') || fl.includes('mês referência') || fl.includes('mes referencia') || fl.includes('referência') || fl.includes('referencia') || fl.includes('mês/ano')) {
      if (preScannedRef) {
        value = preScannedRef;
      }

      if (!value) {
        const refKeywordsAll = [
          'mes de referencia', 'mes referencia', 'mes ref',
          'mes/ano', 'referencia', 'ref', 'competencia', 'mes de ref',
          'referente a', 'conta referente a', 'essa conta e de'
        ];
        
        for (const kw of refKeywordsAll) {
          const regexVal = new RegExp(`${kw}\\s*[:\\- ]*\\s*(?<![0-9/])([0-1][0-9])\\s*\\/\\s*(20[2-3][0-9])(?![0-9/])`, 'i');
          const match = normText.match(regexVal);
          if (match) {
            value = `${match[1].trim()}/${match[2].trim()}`;
            break;
          }
          
          const regexValShort = new RegExp(`${kw}\\s*[:\\- ]*\\s*(?<![0-9/])([0-1][0-9])\\s*\\/\\s*([0-9]{2})(?![0-9/])`, 'i');
          const matchShort = normText.match(regexValShort);
          if (matchShort) {
            value = `${matchShort[1].trim()}/20${matchShort[2].trim()}`;
            break;
          }

          const regexMonth = new RegExp(`${kw}\\s*[:\\- ]*\\s*(?<![0-9/])\\b(${Object.keys(monthMapLocal).join('|')})\\s*[-/\\s]?\\s*(20[2-3][0-9]|[0-9]{2})\\b(?![0-9/])`, 'i');
          const matchMonth = normText.match(regexMonth);
          if (matchMonth) {
            const mName = matchMonth[1].toLowerCase();
            const mNum = monthMapLocal[mName];
            let y = matchMonth[2];
            if (y.length === 2) y = '20' + y;
            value = `${mNum}/${y}`;
            break;
          }
        }
      }

      if (!value) {
        // Vertical lookahead scanning with coordinate alignment!
        const refKeywordsAll = [
          'mes/ano', 'referente a', 'mes ref', 'mes de referencia',
          'mes referencia', 'referencia', 'ref', 'conta referente a',
          'essa conta e de'
        ];
        
        for (let i = 0; i < lines.length; i++) {
          const lineLower = lines[i]; // already normalized and lowercase!
          const matchedKw = refKeywordsAll.find(kw => lineLower.includes(kw));
          if (matchedKw) {
            // Pattern for MM/YYYY or MM/YY
            const patternMMYY = /(?<![0-9/])(0?[1-9]|1[0-2])\s*\/\s*(20[2-3][0-9]|[2-3][0-9])(?![0-9/])/i;
            // Pattern for Word Month + Year
            const patternWordY = new RegExp(`(?<![0-9/])\\b((${Object.keys(monthMapLocal).join('|')})\\s*[-/\\s]?\\s*(20[2-3][0-9]|[0-9]{2}))\\b(?![0-9/])`, 'i');
            
            // Check next line MM/YYYY or Month Word
            if (i + 1 < lines.length) {
              let matchedVal = findClosestValueByCoordinates(lines[i], lines[i+1], matchedKw, patternMMYY);
              if (!matchedVal) {
                matchedVal = findClosestValueByCoordinates(lines[i], lines[i+1], matchedKw, patternWordY);
              }
              if (matchedVal) {
                const cleanVal = matchedVal.replace(/\s+/g, '');
                if (cleanVal.includes('/')) {
                  const parts = cleanVal.split('/');
                  let m = parts[0].padStart(2, '0');
                  let y = parts[1];
                  if (y.length === 2) y = '20' + y;
                  value = `${m}/${y}`;
                  break;
                } else {
                  const mMatch = matchedVal.match(new RegExp(`(${Object.keys(monthMapLocal).join('|')})`, 'i'));
                  const yMatch = matchedVal.match(/(20[2-3][0-9]|[0-9]{2})/);
                  if (mMatch && yMatch) {
                    const mNum = monthMapLocal[mMatch[1].toLowerCase()];
                    let y = yMatch[1];
                    if (y.length === 2) y = '20' + y;
                    value = `${mNum}/${y}`;
                    break;
                  }
                }
              }
            }
            
            // Check current line as fallback
            if (!value) {
              let matchedVal = findClosestValueByCoordinates(lines[i], lines[i], matchedKw, patternMMYY);
              if (!matchedVal) {
                matchedVal = findClosestValueByCoordinates(lines[i], lines[i], matchedKw, patternWordY);
              }
              if (matchedVal) {
                const cleanVal = matchedVal.replace(/\s+/g, '');
                if (cleanVal.includes('/')) {
                  const parts = cleanVal.split('/');
                  let m = parts[0].padStart(2, '0');
                  let y = parts[1];
                  if (y.length === 2) y = '20' + y;
                  value = `${m}/${y}`;
                  break;
                } else {
                  const mMatch = matchedVal.match(new RegExp(`(${Object.keys(monthMapLocal).join('|')})`, 'i'));
                  const yMatch = matchedVal.match(/(20[2-3][0-9]|[0-9]{2})/);
                  if (mMatch && yMatch) {
                    const mNum = monthMapLocal[mMatch[1].toLowerCase()];
                    let y = yMatch[1];
                    if (y.length === 2) y = '20' + y;
                    value = `${mNum}/${y}`;
                    break;
                  }
                }
              }
            }
          }
        }
      }

      if (!value) {
        // Try direct searching for month abbreviation + year (allowing spaces around slash or separator)
        const rx = new RegExp(`\\b(${Object.keys(monthMapLocal).join('|')})\\s*[-/\\s]\\s*(20[2-3][0-9]\\b|[0-9]{2}\\b)`, 'i');
        const match = normText.match(rx);
        if (match) {
          const mName = match[1].toLowerCase();
          const mNum = monthMapLocal[mName];
          let y = match[2];
          if (y.length === 2) {
            y = '20' + y;
          }
          value = `${mNum}/${y}`;
        }
      }

      if (!value) {
        const matches = [...normText.matchAll(/(?<![0-9/])(0[1-9]|1[0-2])\s*\/\s*(20[2-3][0-9])(?![0-9/])/g)];
        if (matches && matches[0]) {
          value = matches[0][1] + "/" + matches[0][2];
        }
      }
    }
    // 3. Vencimento Date (Due Date)
    else if (fn.includes('vencimento') || fl.includes('vencimento') || fl.includes('venc') || fl.includes('pagar até') || fl.includes('pague')) {
      if (preScannedVenc) {
        value = preScannedVenc;
      }

      if (!value) {
        // Coordinated alignment scanner (primary and extremely robust for multi-column and stacked table layouts)
        const vencimentoKeywords = [
          'vencimento', 'data de vencimento', 'pague ate', 'pagar ate', 
          'vcto', 'vence em', 'vence', 'venc', 'venc:', 'data limite', 'vencimento em', 'vencto', 'vto'
        ];
        
        for (let i = 0; i < lines.length; i++) {
          const lineLower = lines[i]; // already normalized and lowercase!
          const matchedKw = vencimentoKeywords.find(kw => lineLower.includes(kw));
          if (matchedKw) {
            const datePattern = /\b([0-3]?[0-9]\/[0-1]?[0-9]\/[1-2][0-9]{3})\b/i;
            
            // Check next line first (most common for column and stacked layouts)
            if (i + 1 < lines.length) {
              const matchedVal = findClosestValueByCoordinates(lines[i], lines[i+1], matchedKw, datePattern);
              if (matchedVal) {
                value = standardizeDate(matchedVal);
                break;
              }
            }
            
            // Check current line
            const matchedValCurr = findClosestValueByCoordinates(lines[i], lines[i], matchedKw, datePattern);
            if (matchedValCurr) {
              value = standardizeDate(matchedValCurr);
              break;
            }
            
            // Check 2 lines ahead
            if (i + 2 < lines.length) {
              const matchedVal2 = findClosestValueByCoordinates(lines[i], lines[i+2], matchedKw, datePattern);
              if (matchedVal2) {
                value = standardizeDate(matchedVal2);
                break;
              }
            }
          }
        }
      }

      if (!value) {
        // Line-by-line exact regex matches search
        const vencimentoKeywords = [
          'vencimento', 'data de vencimento', 'pague ate', 'pagar ate', 
          'vcto', 'vence em', 'vence', 'venc', 'venc:', 'vencto', 'vto'
        ];
        for (const kw of vencimentoKeywords) {
          const regexVal = new RegExp(`${kw}\\s*[:\\- ]*\\s*([0-3][0-9]\/[0-1][0-9]\/[1-2][0-9]{3})`, 'i');
          const match = normText.match(regexVal);
          if (match) {
            value = standardizeDate(match[1].trim());
            break;
          }
        }
      }

      if (!value) {
        // Broad context look-ahead chronos scanner with reading/emission lines ignored (Safety Fallback)
        const vencimentoKeywords = [
          'vencimento', 'data de vencimento', 'pague ate', 'pagar ate', 
          'vcto', 'vence em', 'vence', 'venc', 'venc:', 'data limite', 'vencimento em', 'vencto', 'vto'
        ];
        
        for (let i = 0; i < lines.length; i++) {
          const lineLower = lines[i]; // already normalized and lowercase!
          if (vencimentoKeywords.some(kw => lineLower.includes(kw))) {
            const contextLines: string[] = [];
            
            // Filter out context lines containing keywords for other dates (like next readings or presentation dates)
            const forbiddenWords = ['leitura', 'proxima', 'anterior', 'realizada', 'prevista'];
            
            for (const offset of [-1, 0, 1, 2]) {
              const idx = i + offset;
              if (idx >= 0 && idx < lines.length) {
                const subLineLower = lines[idx]; // already normalized & lowercase!
                if (!forbiddenWords.some(fw => subLineLower.includes(fw))) {
                  contextLines.push(lines[idx]);
                }
              }
            }
            
            const contextText = contextLines.join(' ');
            const foundDates = [...contextText.matchAll(/\b([0-3]?[0-9])\/([0-1]?[0-9])\/([1-2][0-9]{3})\b/g)];
            if (foundDates.length > 0) {
              const parsedDates = foundDates.map(fd => {
                const day = parseInt(fd[1], 10);
                const month = parseInt(fd[2], 10);
                const year = parseInt(fd[3], 10);
                return {
                  raw: `${fd[1].padStart(2, '0')}/${fd[2].padStart(2, '0')}/${fd[3]}`,
                  time: new Date(year, month - 1, day).getTime()
                };
              });
              
              // Sort by date descending (latest date is most probably the Vencimento)
              parsedDates.sort((a, b) => b.time - a.time);
              if (parsedDates.length > 0) {
                value = parsedDates[0].raw;
                console.log(`[Smart DueDate Scanner] Encontrou múltiplas datas no contexto de vencimento. Selecionando a mais recente com salvaguarda: ${value}`);
                break;
              }
            }
          }
        }
      }

      if (!value && generalDateMatches && generalDateMatches.length > 0) {
        // If we have general dates, look for one that is not emission date (usually second is vencimento)
        if (generalDateMatches.length > 1) {
          value = standardizeDate(generalDateMatches[1]);
        } else {
          value = standardizeDate(generalDateMatches[0]);
        }
      }
    }
    // 4. Consumption (kWh)
    else if (
      fn.includes('consumo') || 
      fn.includes('kwh') || 
      fn.includes('energia') || 
      fl.includes('consumo') || 
      fl.includes('kwh') || 
      fl.includes('energia')
    ) {
      // 0. TOP PRIORITY: BILL ITEM ROWS extraction (TUSD / TE active energy item rows)
      if (!value) {
        const itemRowPatterns = [
          // Enel: "(TUSD) KWH 1.440,000" or "(TE) KWH 1.440,000"
          /(?:tusd|te)\s*\(?\s*kwh\s*\)?\s*([0-9\s\.,]{3,15})\s+[0-9]/i,
          // CPFL: "TUSD DEZ/25 kWh 1.046,0000" or "TE DEZ/25 kWh 1.046,0000"
          /(?:tusd|te)(?:\s+[a-z]{3}\/[0-9]{2})?\s*kwh\s*([0-9\s\.,]{3,15})\b/i,
          // CPFL 2: "Consumo Uso Sistema [KWh]-TUSD"
          /tusd\s*kwh\s*([0-9\s\.,]{3,15})/i,
          /te\s*kwh\s*([0-9\s\.,]{3,15})/i,
          // "Seu consumo foi de 5222 kWh em 29 dias"
          /seu\s+consumo\s+foi\s+de\s*([0-9\s\.,]+)\s*kwh/i,
          // "Consumo (kWh) ... 5 222"
          /consumo(?:\s*\(kwh\))?(?:\s*\(atual-anterior\))?\s*[:\- =]*\s*([0-9\s\.,]+)\s*kwh/i,
        ];

        for (const rx of itemRowPatterns) {
          const match = normText.match(rx);
          if (match) {
            const raw = match[1].trim();
            // clean spaces for thousands separators like "5 222"
            const cleanedVal = raw.replace(/(\d)\s+(\d)/g, '$1$2').replace(/\s/g, '');
            const cleanNum = parseFloat(cleanedVal.replace(/\./g, '').replace(',', '.'));
            if (!isNaN(cleanNum) && cleanNum > 0 && cleanNum < 150000 && cleanNum !== 2025 && cleanNum !== 2026 && cleanNum !== 2024 && cleanNum !== 2023) {
              if (isProbablyTariff(cleanedVal)) {
                console.log(`[Top Priority Item Row Match] Ignored tariff value: "${cleanedVal}"`);
                continue;
              }
              value = cleanedVal;
              console.log(`[Top Priority Item Row Match] Pattern: "${rx}" -> Raw: "${raw}" -> Value: "${value}"`);
              break;
            }
          }
        }
      }

      // 0.1 EXPLICIT NOMENCLATURES PRIORITY SCANNER
      if (!value) {
        // Direct regex patterns with captures
        const directRegexes = [
          /(?:quant\.?\s*faturada|quantidade\s+faturada|qtde\.?\s*faturada)\s*[:\- R$]*\s*\b([0-9\s\.,]+)\b/i,
          /(?:quant\.?\s*\(?\s*kwh\s*\)?|quant\.?\s*kwh|qtde\.?\s*\(?\s*kwh\s*\)?)\s*[:\- R$]*\s*\b([0-9\s\.,]+)\b/i,
          /(?:consumo\s*(?:em\s+)?kwh|consumo\s*(?:de\s+)?kwh|consumo\s*(?:de\s+energia\s+)?kwh)\s*[:\- R$]*\s*\b([0-9\s\.,]+)\b/i,
          /consumo\s+em\s+kwh\s*[:\- R$]*\s*\b([0-9\s\.,]+)\b/i,
          /consumo\s+kwh\s*[:\- R$]*\s*\b([0-9\s\.,]+)\b/i,
        ];
        for (const regex of directRegexes) {
          const match = normText.match(regex);
          if (match) {
            const raw = match[1].trim();
            const cleanedVal = raw.replace(/(\d)\s+(\d)/g, '$1$2').replace(/\s/g, '');
            const cleanVal = parseFloat(cleanedVal.replace(/\./g, '').replace(',', '.'));
            if (!isNaN(cleanVal) && cleanVal > 0 && cleanVal < 150000 && cleanVal !== 2025 && cleanVal !== 2026 && cleanVal !== 2024 && cleanVal !== 2023) {
              if (isProbablyTariff(cleanedVal)) {
                console.log(`[Spec Nomenclatures Direct Regex] Ignored tariff value: "${cleanedVal}"`);
                continue;
              }
              value = cleanedVal;
              console.log(`[Spec Nomenclatures Direct Regex] Casou perfeitamente: "${regex}" -> "${value}"`);
              break;
            }
          }
        }
      }

      if (!value) {
        const specKeywords = [
          { pattern: /quant\.?\s*faturada/i, name: 'Quant. faturada' },
          { pattern: /quant\.?\s*\(\s*kwh\s*\)/i, name: 'Quant.(kwh)' },
          { pattern: /quant\.?\s*kwh/i, name: 'Quant. kwh' },
          { pattern: /consumo\s+em\s+kwh/i, name: 'Consumo em kWh' },
          { pattern: /consumo\s+kwh/i, name: 'consumo KWh' },
          { pattern: /consumo\s+faturado/i, name: 'Consumo faturado' },
          { pattern: /consumo\s*\(kwh\)/i, name: 'Consumo (kWh)' }
        ];

        for (const kw of specKeywords) {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim(); // already normalized and lowercase
            if (kw.pattern.test(line)) {
              console.log(`[Spec Nomenclatures] Encontrado cabeçalho de consumo correspondente a "${kw.name}" na linha: "${line}"`);
              
              const matchIndex = line.search(kw.pattern);
              if (matchIndex !== -1) {
                const subStr = line.substring(matchIndex);
                const numbers = [...subStr.matchAll(/\b([0-9\.,]+)\b/g)];
                for (const num of numbers) {
                  const rawNum = num[1].replace(/(\d)\s+(\d)/g, '$1$2').replace(/\s/g, '');
                  const cleanVal = parseFloat(rawNum.replace(/\./g, '').replace(',', '.'));
                  if (!isNaN(cleanVal) && cleanVal > 0 && cleanVal < 150000 && cleanVal !== 2025 && cleanVal !== 2026 && cleanVal !== 2024 && cleanVal !== 2023) {
                    if (isProbablyTariff(rawNum)) {
                      console.log(`[Spec Nomenclatures Same Line] Ignored tariff value: "${rawNum}"`);
                      continue;
                    }
                    value = rawNum;
                    console.log(`[Spec Nomenclatures] Número extraído com sucesso da mesma linha: "${value}" (valor numérico: ${cleanVal})`);
                    break;
                  }
                }
              }
              
              if (value) break;

              // Se não encontrou número na mesma linha, vasculha a linha seguinte (comum em listagens horizontais) por proximidade de coordenadas
              if (i + 1 < lines.length) {
                const matchObj = line.match(kw.pattern);
                const kwText = matchObj ? matchObj[0] : kw.name;
                const matchedVal = findClosestValueByCoordinates(lines[i], lines[i+1], kwText, /\b([0-9\.,]+)\b/gi);
                if (matchedVal) {
                  const rawNum = matchedVal.replace(/(\d)\s+(\d)/g, '$1$2').replace(/\s/g, '');
                  const cleanVal = parseFloat(rawNum.replace(/\./g, '').replace(',', '.'));
                  if (!isNaN(cleanVal) && cleanVal > 0 && cleanVal < 150000 && cleanVal !== 2025 && cleanVal !== 2026 && cleanVal !== 2024 && cleanVal !== 2023) {
                    if (isProbablyTariff(rawNum)) {
                      console.log(`[Spec Nomenclatures Next Line] Ignored tariff value: "${rawNum}"`);
                    } else {
                      value = rawNum;
                      console.log(`[Spec Nomenclatures] Número extraído da linha seguinte por coordenadas: "${value}" (valor: ${cleanVal})`);
                    }
                  }
                }
                
                // Fallback se o alinhamento de coordenadas não retornar um valor mas existirem números
                if (!value) {
                  const nextLine = lines[i+1].trim();
                  const numbersNext = [...nextLine.matchAll(/\b([0-9\.,]+)\b/g)];
                  for (const num of numbersNext) {
                    const rawNum = num[1].replace(/(\d)\s+(\d)/g, '$1$2').replace(/\s/g, '');
                    const cleanVal = parseFloat(rawNum.replace(/\./g, '').replace(',', '.'));
                    if (!isNaN(cleanVal) && cleanVal > 0 && cleanVal < 150000 && cleanVal !== 2025 && cleanVal !== 2026 && cleanVal !== 2024 && cleanVal !== 2023) {
                      if (isProbablyTariff(rawNum)) {
                        console.log(`[Spec Nomenclatures Next Line Fallback] Ignored tariff value: "${rawNum}"`);
                        continue;
                      }
                      value = rawNum;
                      console.log(`[Spec Nomenclatures Fallback] Número extraído da linha seguinte: "${value}" (valor: ${cleanVal})`);
                      break;
                    }
                  }
                }
              }

              if (value) break;

              // Se ainda não, vasculha 2 linhas seguintes por proximidade de coordenadas
              if (i + 2 < lines.length) {
                const matchObj = line.match(kw.pattern);
                const kwText = matchObj ? matchObj[0] : kw.name;
                const matchedVal2 = findClosestValueByCoordinates(lines[i], lines[i+2], kwText, /\b([0-9\.,]+)\b/gi);
                if (matchedVal2) {
                  const rawNum2 = matchedVal2.replace(/(\d)\s+(\d)/g, '$1$2').replace(/\s/g, '');
                  const cleanVal2 = parseFloat(rawNum2.replace(/\./g, '').replace(',', '.'));
                  if (!isNaN(cleanVal2) && cleanVal2 > 0 && cleanVal2 < 150000 && cleanVal2 !== 2025 && cleanVal2 !== 2026 && cleanVal2 !== 2024 && cleanVal2 !== 2023) {
                    if (isProbablyTariff(rawNum2)) {
                      console.log(`[Spec Nomenclatures Two Lines Below] Ignored tariff value: "${rawNum2}"`);
                    } else {
                      value = rawNum2;
                      console.log(`[Spec Nomenclatures] Número extraído de duas linhas abaixo por coordenadas: "${value}" (valor: ${cleanVal2})`);
                    }
                  }
                }

                // Fallback se o alinhamento de coordenadas não retornar um valor mas existirem números
                if (!value) {
                  const nextLine2 = lines[i+2].trim();
                  const numbersNext2 = [...nextLine2.matchAll(/\b([0-9\.,]+)\b/g)];
                  for (const num of numbersNext2) {
                    const rawNum = num[1].replace(/(\d)\s+(\d)/g, '$1$2').replace(/\s/g, '');
                    const cleanVal = parseFloat(rawNum.replace(/\./g, '').replace(',', '.'));
                    if (!isNaN(cleanVal) && cleanVal > 0 && cleanVal < 150000 && cleanVal !== 2025 && cleanVal !== 2026 && cleanVal !== 2024 && cleanVal !== 2023) {
                      if (isProbablyTariff(rawNum)) {
                        console.log(`[Spec Nomenclatures Two Lines Below Fallback] Ignored tariff value: "${rawNum}"`);
                        continue;
                      }
                      value = rawNum;
                      console.log(`[Spec Nomenclatures Fallback] Número extraído de duas linhas abaixo: "${value}" (valor: ${cleanVal})`);
                      break;
                    }
                  }
                }
              }

              if (value) break;
            }
          }
          if (value) break;
        }
      }

      // 1. UNIVERSAL MATHEMATICAL SEQUENCE SCANNER (Anterior, Atual, Constante, Consumo)
      // This is 100% accurate because it uses the mathematical rule: Consumo = (Atual - Anterior) * Constante
      if (!value) {
        const getPossibleValues = (s: string): number[] => {
          const clean = s.replace(/[^0-9.,]/g, '');
          if (!clean) return [];
          const results: number[] = [];
          
          // Option A: PT-BR style (dot is thousands, comma is decimal)
          const ptStyle = clean.replace(/\./g, '').replace(',', '.');
          const ptNum = parseFloat(ptStyle);
          if (!isNaN(ptNum)) results.push(ptNum);
          
          // Option B: US style (comma is thousands, dot is decimal)
          const usStyle = clean.replace(/,/g, '');
          const usNum = parseFloat(usStyle);
          if (!isNaN(usNum)) results.push(usNum);
          
          // Option C: Ignore all formatting (treat as plain digits)
          const plainStyle = clean.replace(/[.,]/g, '');
          const plainNum = parseFloat(plainStyle);
          if (!isNaN(plainNum)) results.push(plainNum);
          
          return [...new Set(results)].filter(v => v > 0);
        };

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          // Skip history lines, address lines, corporate lines to prevent false matches
          const isIgnoredLine = 
            line.includes('historico') || 
            line.includes('cnpj') ||
            line.includes('telefone') ||
            line.includes('avenida') ||
            line.includes('rua') ||
            line.includes('cep') ||
            line.includes('chave') ||
            line.includes('acesso') ||
            line.includes('protocolo') ||
            line.includes('autorizacao') ||
            line.includes('cpf') ||
            line.includes('serie') ||
            line.includes('fiscal') ||
            line.includes('nf3e') ||
            line.includes('nf-e') ||
            line.includes('nfe') ||
            line.includes('ie:') ||
            line.includes('inscricao') ||
            line.includes('data') ||
            // If the line has 4 or more numeric chunk groups of 4 digits (typical of NF3-e Access Key spaced-out chunks)
            (line.match(/\b\d{4}\b/g) || []).length >= 4 ||
            // If the line contains a single very long sequence of digits (e.g. 20 or more digits like a barcode or raw key)
            /\d{15,}/.test(line.replace(/\s/g, ''));
            
          if (isIgnoredLine) continue;

          // Find matches that look like numbers (digits with dots or commas)
          const numMatches = [...line.matchAll(/\b([0-9\.,]+)\b/g)].map(m => m[1].trim());
          if (numMatches.length < 3) continue;
          
          const candidates = numMatches.map(str => ({
            original: str,
            values: getPossibleValues(str)
          })).filter(c => c.values.length > 0);
          
          if (candidates.length < 3) continue;

          let foundMathMatch = false;

          // Check Case 1: 4 numbers (Anterior, Atual, Constante, Consumo)
          // Search indices: idxAnt < idxAtu < idxConst < idxCons
          for (let idxAnt = 0; idxAnt < candidates.length - 3; idxAnt++) {
            for (let idxAtu = idxAnt + 1; idxAtu < candidates.length - 2; idxAtu++) {
              for (let idxConst = idxAtu + 1; idxConst < candidates.length - 1; idxConst++) {
                for (let idxCons = idxConst + 1; idxCons < candidates.length; idxCons++) {
                  
                  if (isProbablyTariff(candidates[idxAnt].original) ||
                      isProbablyTariff(candidates[idxAtu].original) ||
                      isProbablyTariff(candidates[idxCons].original)) {
                    continue;
                  }

                  const ants = candidates[idxAnt].values;
                  const atus = candidates[idxAtu].values;
                  const consts = candidates[idxConst].values;
                  const conss = candidates[idxCons].values;
                  
                  for (const valAnt of ants) {
                    for (const valAtu of atus) {
                      for (const valConst of consts) {
                        for (const valCons of conss) {
                          if (valCons < 5.0) continue; // Minimum active monthly consumption is at least 5.0 kWh!

                          const diff = valAtu - valAnt;
                          if (diff <= 0) continue;
                          
                          const expectedConsumo = diff * valConst;
                          const ratio = Math.abs(expectedConsumo - valCons) / valCons;
                          
                          // Allow a loose check (difference of <= 1.0) only if valCons is large enough (>= 30). Otherwise, require a very tight ratio.
                          if (ratio < 0.01 || (valCons >= 30.0 && Math.abs(expectedConsumo - valCons) <= 1.0)) {
                            value = candidates[idxCons].original;
                            console.log(`[Universal Math Scanner] MATCH 4 COLS ("${line}"): Anterior=${valAnt} ("${candidates[idxAnt].original}"), Atual=${valAtu} ("${candidates[idxAtu].original}"), Constante=${valConst} ("${candidates[idxConst].original}"), Consumo=${valCons} -> SELECIONADO="${value}"`);
                            foundMathMatch = true;
                            break;
                          }
                        }
                        if (foundMathMatch) break;
                      }
                      if (foundMathMatch) break;
                    }
                    if (foundMathMatch) break;
                  }
                  if (foundMathMatch) break;
                }
                if (foundMathMatch) break;
              }
              if (foundMathMatch) break;
            }
            if (foundMathMatch) break;
          }

          if (foundMathMatch) break;

          // Check Case 2: 3 numbers (Anterior, Atual, Consumo) with Constante = 1
          // Search indices: idxAnt < idxAtu < idxCons
          for (let idxAnt = 0; idxAnt < candidates.length - 2; idxAnt++) {
            for (let idxAtu = idxAnt + 1; idxAtu < candidates.length - 1; idxAtu++) {
              for (let idxCons = idxAtu + 1; idxCons < candidates.length; idxCons++) {
                
                if (isProbablyTariff(candidates[idxAnt].original) ||
                    isProbablyTariff(candidates[idxAtu].original) ||
                    isProbablyTariff(candidates[idxCons].original)) {
                  continue;
                }

                const ants = candidates[idxAnt].values;
                const atus = candidates[idxAtu].values;
                const conss = candidates[idxCons].values;
                
                for (const valAnt of ants) {
                  for (const valAtu of atus) {
                    for (const valCons of conss) {
                      if (valCons < 5.0) continue; // Minimum active monthly consumption is at least 5.0 kWh!

                      const diff = valAtu - valAnt;
                      if (diff <= 0) continue;
                      
                      const ratio = Math.abs(diff - valCons) / valCons;
                      // Allow a loose check (difference of <= 1.0) only if valCons is large enough (>= 30). Otherwise, require a very tight ratio.
                      if (ratio < 0.01 || (valCons >= 30.0 && Math.abs(diff - valCons) <= 1.0)) {
                        value = candidates[idxCons].original;
                        console.log(`[Universal Math Scanner] MATCH 3 COLS ("${line}"): Anterior=${valAnt} ("${candidates[idxAnt].original}"), Atual=${valAtu} ("${candidates[idxAtu].original}"), Consumo=${valCons} -> SELECIONADO="${value}"`);
                        foundMathMatch = true;
                        break;
                      }
                    }
                    if (foundMathMatch) break;
                  }
                  if (foundMathMatch) break;
                }
                if (foundMathMatch) break;
              }
              if (foundMathMatch) break;
            }
            if (foundMathMatch) break;
          }

          if (foundMathMatch) break;
        }
      }

      // 2. ENERGISA SPECIFIC SEQUENCE ("Total anterior atual constante consumo")
      if (!value) {
        const energisaTotalMatch = normText.match(/\bTotal\s+([0-9\.,]{3,8})\s+([0-9\.,]{3,8})\s+([0-9\.,]+)\s+([0-9\.,]{2,6})\b/i);
        if (energisaTotalMatch) {
          const candidate = energisaTotalMatch[3].trim();
          if (!isProbablyTariff(candidate)) {
            value = candidate;
            console.log(`[Energisa Total Match] Encontrado consumo por sequência total: "${energisaTotalMatch[0]}" -> ${value}`);
          }
        }
      }

      // 3. ENERGISA "Consumo em kWh" SPECIFIC CHARGE LINE
      if (!value) {
        const energisaConsumoPattern = normText.match(/Consumo\s+em\s+kWh\s*(?:[A-Z]{3})?\s*([0-9\.,]+)/i) ||
                                       normText.match(/Consumo\s+em\s+kWh\s+([0-9\.,]+)/i);
        if (energisaConsumoPattern) {
          value = energisaConsumoPattern[1].trim();
        }
      }

      // 4. CPFL SPECIFIC LINE FALLBACKS
      if (!value) {
        const cpflMeter = normText.match(/energia\s+ativa(?:-kwh)?\s+(?:unico|unico)[\s\S]*?([0-9\.,]+)\s*$/i) ||
                          normText.match(/energia\s+ativa(?:-kwh)?\s+(?:unico|unico)[\s\S]*?([0-9\.,]+)/i);
        if (cpflMeter) {
          value = cpflMeter[1].trim();
        }
      }
      if (!value) {
        const cpflTusd = normText.match(/consumo\s+uso\s+sistema[\s\S]*?tusd[\s\S]*?kwh\s+([0-9\.,]+)/i);
        if (cpflTusd) {
          value = cpflTusd[1].trim();
        }
      }
      if (!value) {
        const cpflTe = normText.match(/consumo\s*-\s*te[\s\S]*?kwh\s+([0-9\.,]+)/i);
        if (cpflTe) {
          value = cpflTe[1].trim();
        }
      }

      // 5. ENEL SPECIFIC TABLE FALLBACKS
      if (!value) {
        const enelSequence = normText.match(/(?:enrg\s+atv|energia\s+ativa|enrg|energ)[\s\S]*?([0-9\.,]+)\s+([0-9\.,]+)\s+([0-9\.,]+)\s+([0-9\.,]+)/i);
        if (enelSequence) {
          const candidate = enelSequence[4].trim();
          if (!isProbablyTariff(candidate)) {
            value = candidate;
          }
        }
      }
      if (!value) {
        const enelMeter = normText.match(/enrg\s+atv[a-z\s]*[\s\S]*?([0-9\.,]+)/i) ||
                          normText.match(/energia\s+ativa[a-z\s]*[\s\S]*?([0-9\.,]+)/i);
        if (enelMeter) {
          const candidate = enelMeter[1].trim();
          if (!isProbablyTariff(candidate)) {
            value = candidate;
          }
        }
      }

      // 6. HISTORIC CONSUMO TABLE FALLBACKS (ENEL e.g. "DEZ/25 4.160,000")
      if (!value) {
        const historyMatches = [...normText.matchAll(/\b(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\s*[\/\-]\s*[0-9]{2}\s+([0-9\.,]+)\b/gi)];
        if (historyMatches.length > 0) {
          let foundRefMatch = false;
          if (preScannedRef) {
            const parts = preScannedRef.split('/');
            if (parts.length === 2) {
              const mNum = parts[0];
              const yNum = parts[1].substring(2);
              const monthMapNum: Record<string, string> = {
                '01': 'jan', '02': 'fev', '03': 'mar', '04': 'abr', '05': 'mai', '06': 'jun',
                '07': 'jul', '08': 'ago', '09': 'set', '10': 'out', '11': 'nov', '12': 'dez'
               };
               const mName = monthMapNum[mNum];
               if (mName) {
                 for (const m of historyMatches) {
                   const matchText = m[0];
                   if ((matchText.includes(mName) || matchText.includes(mNum)) && matchText.includes(yNum)) {
                     const candidate = m[1].trim();
                     if (!isProbablyTariff(candidate)) {
                       value = candidate;
                       foundRefMatch = true;
                       break;
                     }
                   }
                 }
               }
            }
          }
          if (!foundRefMatch) {
            for (const m of historyMatches) {
              const candidate = m[1].trim();
              if (!isProbablyTariff(candidate)) {
                value = candidate;
                break;
              }
            }
          }
        }
      }

      // 7. GENERIC TUSD/TE/CHARGES FALLBACK PATTERNS
      if (!value) {
        const chargesPatterns = [
          /uso\s+sist\.?\s*distr\.?\s*\(tusd\)[\s\S]*?kwh\s*([0-9\.,]+)/i,
          /energia\s*\(te\)[\s\S]*?kwh\s*([0-9\.,]+)/i,
          /uso\s+sistema\s+distrib\w*[\s\S]*?([0-9\.,]+)/i,
          /tusd\s+kwh\s+([0-9\.,]+)/i,
          /te\s+kwh\s+([0-9\.,]+)/i,
          /tusd[\s\S]*?kwh\s*([0-9\.,]+)/i,
          /te[\s\S]*?kwh\s*([0-9\.,]+)/i,
          /uso\s+sistema[\s\S]*?kwh\s*([0-9\.,]+)/i,
          /uso\s+sist[\s\S]*?\b([0-9\.,]+)\b/i,
          /consumo\s*-\s*te[\s\S]*?\b([0-9\.,]+)\b/i,
          /(?:uso\s+sist\.?\s*distr\.?\s*\(tusd\)|\benergia\s*\(te\))[\s\S]*?([0-9\.,]+)/i
        ];
        for (const pattern of chargesPatterns) {
          const match = normText.match(pattern);
          if (match) {
            const candidate = match[1].trim();
            if (!isProbablyTariff(candidate)) {
              value = candidate;
              break;
            }
          }
        }
      }

      // 5. User spec patterns covering requested nomenclatures
      if (!value) {
        const specPatterns = [
          /(?:quant\.\s*faturada|quantidade\s+faturada)\s*[:\- R$]*\s*\b([0-9\.,]+)\b/i,
          /quant\.\s*\(kwh\)\s*[:\- R$]*\s*\b([0-9\.,]+)\b/i,
          /quant\.\s*kwh\s*[:\- R$]*\s*\b([0-9\.,]+)\b/i,
          /consumo\s+em\s+kwh\s*[:\- R$]*\s*\b([0-9\.,]+)\b/i,
          /consumo\s+kwh\s*[:\- R$]*\s*\b([0-9\.,]+)\b/i,
          /consumo\s+ativo\s*[:\- R$]*\s*\b([0-9\.,]+)\b/i,
          /energia\s+ativa\s*[:\- R$]*\s*\b([0-9\.,]+)\b/i,
          /total\s+consumido\s*[:\- R$]*\s*\b([0-9\.,]+)\b/i
        ];
        for (const regex of specPatterns) {
          const match = normText.match(regex);
          if (match) {
            const candidate = match[1].trim();
            if (!isProbablyTariff(candidate)) {
              value = candidate;
              break;
            }
          }
        }
      }

      // 6. Proximity column-header vertical scanning for Consumption values (User requested nomenclatures)
      if (!value) {
        const consumptionHeaders = [
          'quant. faturada', 'quant.faturada', 'quantidade faturada',
          'quant.(kwh)', 'quant. (kwh)', 'quant.kwh', 'quant. kwh',
          'consumo em kwh', 'consumo kwh', 'consumo de kwh', 'consumo mes',
          'qtde kwh mes', 'quantidade kwh', 'energia ativa', 'consumo/kwh', 'consumo / kwh'
        ];
        
        for (let i = 0; i < lines.length; i++) {
          const lineLower = lines[i]; // already normalized & lowercase!
          if (consumptionHeaders.some(kw => lineLower.includes(kw))) {
            let foundNum = "";
            let searchIdx = -1;
            let matchedHeaderKeyword = "";
            for (const header of consumptionHeaders) {
              const pos = lineLower.indexOf(header);
              if (pos !== -1) {
                searchIdx = pos;
                matchedHeaderKeyword = header;
                break;
              }
            }

            // A. Check on current line after coordinates of the header word
            const checkText = searchIdx !== -1 ? lines[i].substring(searchIdx) : lines[i];
            const numbersOnLine = [...checkText.matchAll(/\b([0-9\.,]+)\b/g)];
            for (const m of numbersOnLine) {
              const rawNum = m[1];
              if (rawNum && !rawNum.includes('/') && !rawNum.includes('-')) {
                const cleanVal = parseFloat(rawNum.replace(/\./g, '').replace(',', '.'));
                if (!isNaN(cleanVal) && cleanVal > 0 && cleanVal < 250000 && cleanVal !== 2025 && cleanVal !== 2026) {
                  if (isProbablyTariff(rawNum)) continue;
                  foundNum = rawNum;
                  break;
                }
              }
            }
            if (foundNum) {
              value = foundNum;
              break;
            }

            // B. If not found, check next line for a valid numeric layout coordinate
            if (i + 1 < lines.length && matchedHeaderKeyword) {
              const matchedVal = findClosestValueByCoordinates(lines[i], lines[i+1], matchedHeaderKeyword, /\b([0-9\.,]+)\b/gi);
              if (matchedVal) {
                const rawNum = matchedVal.replace(/(\d)\s+(\d)/g, '$1$2').replace(/\s/g, '');
                const cleanVal = parseFloat(rawNum.replace(/\./g, '').replace(',', '.'));
                if (!isNaN(cleanVal) && cleanVal > 0 && cleanVal < 250000 && cleanVal !== 2025 && cleanVal !== 2026) {
                  if (!isProbablyTariff(rawNum)) {
                    foundNum = rawNum;
                  }
                }
              }
              
              // Fallback se o alinhamento não retornar mas há números
              if (!foundNum) {
                const matchesNext = [...lines[i+1].matchAll(/\b([0-9\.,]+)\b/g)];
                for (const m of matchesNext) {
                  const rawNum = m[1];
                  if (rawNum && !rawNum.includes('/') && !rawNum.includes('-')) {
                    const cleanVal = parseFloat(rawNum.replace(/\./g, '').replace(',', '.'));
                    if (!isNaN(cleanVal) && cleanVal > 0 && cleanVal < 250000 && cleanVal !== 2025 && cleanVal !== 2026) {
                      if (isProbablyTariff(rawNum)) continue;
                      foundNum = rawNum;
                      break;
                    }
                  }
                }
              }
            }
            if (foundNum) {
              value = foundNum;
              break;
            }

            // C. Or look 2 lines ahead
            if (i + 2 < lines.length && matchedHeaderKeyword) {
              const matchedVal2 = findClosestValueByCoordinates(lines[i], lines[i+2], matchedHeaderKeyword, /\b([0-9\.,]+)\b/gi);
              if (matchedVal2) {
                const rawNum2 = matchedVal2.replace(/(\d)\s+(\d)/g, '$1$2').replace(/\s/g, '');
                const cleanVal2 = parseFloat(rawNum2.replace(/\./g, '').replace(',', '.'));
                if (!isNaN(cleanVal2) && cleanVal2 > 0 && cleanVal2 < 250000 && cleanVal2 !== 2025 && cleanVal2 !== 2026) {
                  if (!isProbablyTariff(rawNum2)) {
                    foundNum = rawNum2;
                  }
                }
              }
              
              // Fallback
              if (!foundNum) {
                const matchesNext2 = [...lines[i+2].matchAll(/\b([0-9\.,]+)\b/g)];
                for (const m of matchesNext2) {
                  const rawNum = m[1];
                  if (rawNum && !rawNum.includes('/') && !rawNum.includes('-')) {
                    const cleanVal = parseFloat(rawNum.replace(/\./g, '').replace(',', '.'));
                    if (!isNaN(cleanVal) && cleanVal > 0 && cleanVal < 250000 && cleanVal !== 2025 && cleanVal !== 2026) {
                      if (isProbablyTariff(rawNum)) continue;
                      foundNum = rawNum;
                      break;
                    }
                  }
                }
              }
            }
            if (foundNum) {
              value = foundNum;
              break;
            }
          }
        }
      }

      if (!value) {
        const matchKwhSimple = normText.match(/\b([0-9\.,]+)\s*kwh\b/i);
        if (matchKwhSimple) {
          const candidate = matchKwhSimple[1].trim();
          if (!isProbablyTariff(candidate)) {
            value = candidate;
          }
        }
      }

      if (!value) {
        const matchKwh = normText.match(/(?:consumo(?:\s+ativo)?|energia(?:\s+ativa)?|quantidade\s+faturada|consumo\s+do\s+mes|consumo\s+do\s+mes|leitura|cons\.?|consumo\s+realizado)\s*[:\s\-#]*\s*([0-9\.,]+)\s*(?:kwh|kw)?/i);
        if (matchKwh) {
          const candidate = matchKwh[1].trim();
          if (!isProbablyTariff(candidate)) {
            value = candidate;
          }
        }
      }

      if (!value) {
        const kwhIndex = normText.indexOf('kwh');
        if (kwhIndex !== -1) {
          const surroundingBefore = normText.substring(Math.max(0, kwhIndex - 30), kwhIndex);
          const numMatch = surroundingBefore.match(/\b([0-9\.,]+)\s*$/);
          if (numMatch) {
            const candidate = numMatch[1].trim();
            if (!isProbablyTariff(candidate)) {
              value = candidate;
            }
          }
        }
      }

      if (value) {
        let cleaned = value.trim();
        if (cleaned.includes(',') && cleaned.includes('.')) {
          cleaned = cleaned.replace(/\./g, '').replace(',', '.');
        } else if (cleaned.includes(',')) {
          cleaned = cleaned.replace(',', '.');
        } else if (cleaned.includes('.')) {
          const dotCount = (cleaned.match(/\./g) || []).length;
          if (dotCount > 1) {
            cleaned = cleaned.replace(/\./g, '');
          } else {
            const parts = cleaned.split('.');
            if (parts[1] && parts[1].length === 3) {
              cleaned = cleaned.replace(/\./g, '');
            }
          }
        }
        cleaned = cleaned.replace(/[^0-9.]/g, '');
        const floatVal = parseFloat(cleaned);
        if (!isNaN(floatVal)) {
          value = floatVal % 1 === 0 ? String(Math.round(floatVal)) : String(floatVal);
        } else {
          value = cleaned;
        }
      }
    }
    // 5. Total Value
    else if (fn.includes('valor_total') || fn.includes('total_fatura') || fl.includes('valor total') || fl.includes('total') || field.type === 'currency') {
      if (preScannedValor) {
        value = preScannedValor;
      }

      if (!value) {
        const valKeywords = [
          'total a pagar', 'valor total', 'total faturado', 'total da fatura', 'fatura',
          'valor liquido', 'total do documento', 'total', 'net total'
        ];
        for (let i = 0; i < lines.length; i++) {
          const lineLower = lines[i]; // already normalized & lowercase!
          const matchedKw = valKeywords.find(kw => lineLower.includes(kw));
          if (matchedKw) {
            const pricePattern = /(?:r\$)?\s*([0-9\.]+,[0-9]{2})/i;
            
            if (i + 1 < lines.length) {
              const matchedVal = findClosestValueByCoordinates(lines[i], lines[i+1], matchedKw, pricePattern);
              if (matchedVal) {
                value = matchedVal;
                break;
              }
            }
            
            const matchedValCurr = findClosestValueByCoordinates(lines[i], lines[i], matchedKw, pricePattern);
            if (matchedValCurr) {
              value = matchedValCurr;
              break;
            }
            
            if (i + 2 < lines.length) {
              const matchedVal2 = findClosestValueByCoordinates(lines[i], lines[i+2], matchedKw, pricePattern);
              if (matchedVal2) {
                value = matchedVal2;
                break;
              }
            }
          }
        }
      }

      if (!value) {
        const valKeywords = [
          'total a pagar', 'valor total', 'total faturado', 'total da fatura', 'fatura',
          'valor liquido', 'total do documento', 'total', 'net total', 'pago'
        ];
        for (const kw of valKeywords) {
          const regexVal = new RegExp(`${kw}\\s*[:\\- r$]*\\s*([0-9\\.\\t ]+,[0-9]{2})`, 'i');
          const match = normText.match(regexVal);
          if (match) {
            value = match[1].trim();
            break;
          }
        }
      }

      if (!value) {
        const r$match = text.match(/(?:R\$)\s*([0-9\.]+,\s*[0-9]{2})/i);
        if (r$match) {
          value = r$match[1].trim();
        }
      }

      if (value && field.type === 'currency') {
        value = standardizeCurrency(value);
      }
    }
    // 6. Concessionaria (Distribuidora / Emissor)
    else if (fn.includes('concessionaria') || fn.includes('distribuidora') || fl.includes('distribuidora') || fl.includes('concessionária') || fl.includes('concessionaria')) {
      const distributors = [
        'Enel', 'Light', 'Neoenergia', 'CPFL', 'Cemig', 'Copel', 'EDP', 'Celesc', 'Energisa', 'Equatorial', 'CEEE', 'RGE', 'Elektro'
      ];
      for (const dist of distributors) {
        const regexDist = new RegExp(`\\b${dist}\\b`, 'i');
        if (text.match(regexDist)) {
          value = dist;
          break;
        }
      }

      if (!value) {
        if (lowerText.includes('eletropaulo') || lowerText.includes('metropolitana')) {
          value = 'Enel';
        }
      }

      if (!value) {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 5);
        if (lines.length > 0) {
          value = lines[0].replace(/[^a-zA-Z\s]/g, '').trim().substring(0, 30);
        }
      }
    }

    // B. GENERAL STANDARD RETRIEVAL FALLBACKS FOR BASIC FIELDS
    if (!value) {
      if (fn.includes('cnpj')) {
        const match = text.match(regexes.cnpj);
        if (match) {
          value = match[1].replace(/[^0-9\-./]/g, '').trim();
        } else if (firstCnpjMatch) {
          value = firstCnpjMatch[1].trim();
        }
      } 
      else if (fn.includes('data') || fn.includes('emissão') || fn.includes('emissao') || field.type === 'date') {
        const match = text.match(regexes.data_emissao);
        if (match) {
          value = standardizeDate(match[1].trim());
        } else if (generalDateMatches && generalDateMatches.length > 0) {
          value = standardizeDate(generalDateMatches[0]);
        }
      } 
      else if (fn.includes('numero') || fn.includes('número') || fn.includes('nota') || fn.includes('fatura') || fn.includes('identificador') || fn.includes('id')) {
        const match = text.match(regexes.numero_nota);
        if (match) {
          value = match[1].replace(/[^\w\d.\-/]/g, '').trim();
        }
      } 
      else if (fn.includes('emissor') || fn.includes('prestador') || fn.includes('nome') || fn.includes('razão') || fn.includes('reclamante') || fn.includes('empresa')) {
        const match = text.match(regexes.emissor_nome);
        if (match) {
          value = match[1].trim();
          value = value.replace(/^[:\s\-]+/, '').trim();
        } else {
          const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 5);
          if (lines.length > 2) {
            value = lines[0].replace(/[^a-zA-Z0-9\s.\-]/g, '').trim();
          }
        }
      }
    }

    // C. EXTRA DYNAMIC LABEL-MAP PROXIMITY SEARCH
    if (!value) {
      try {
        const escapedLabel = field.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`${escapedLabel}\\s*[:\\- ]*\\s*([^\n\r]{1,50})`, 'i');
        const labelMatch = text.match(pattern);
        if (labelMatch) {
          let candidate = labelMatch[1].trim();
          if (field.type === 'date') {
            candidate = standardizeDate(candidate);
          } else if (field.type === 'currency') {
            candidate = standardizeCurrency(candidate);
          }
          value = candidate;
        }
      } catch (e) {
        // Safe skip regex error
      }
    }

    result[field.name] = value || "";
  });

  return result;
}

/**
 * Checks if a specific page's extracted text is a corporate protocol page
 * (receipt, MM Delivery/DIAS cover/tracking sheet) rather than the actual utility invoice.
 */
export function isProtocolPage(pageText: string): boolean {
  if (!pageText) return false;
  const upper = pageText.toUpperCase();
  
  return (
    upper.includes("PROTOCOLO DE ACOMPANHAMENTO") ||
    upper.includes("ACOMPANHAMENTO DE NF") ||
    upper.includes("DEPARTAMENTO DE COMPRAS") ||
    upper.includes("PROTOCOLO DE ENTREGA") ||
    upper.includes("PROTOCOLO DE RECEBIMENTO") ||
    (upper.includes("DIAS ENTREGADORA") && upper.includes("PROTOCOLO")) ||
    (upper.includes("DELIVERY TRANSPORTES") && upper.includes("PROTOCOLO")) ||
    upper.includes("QUANTIDADE DE PARCELAS:") ||
    upper.includes("DATA DE VENCIMENTO - PARCELA") ||
    upper.includes("ASSINATURA DO APROVADOR") ||
    upper.includes("NOME DO EMITENTE:") ||
    upper.includes("DATA RECEBIMENTO NA MATRIZ") ||
    upper.includes("OBS: ENVIADO VIA EMAIL?")
  );
}

/**
 * Parses binary base64 PDF using unpdf to extract clean plain text
 */
export async function extractPDFText(base64Data: string): Promise<string> {
  const cleanBase64 = base64Data.replace(/^data:application\/pdf;base64,/, "");
  const buffer = Buffer.from(cleanBase64, 'base64');
  const uint8Array = new Uint8Array(buffer);
  
  try {
    const result = await extractText(uint8Array) as any;
    if (!result) return "";

    // 1. Check if the unpdf library returned page objects
    if (result.pages && Array.isArray(result.pages)) {
      const nonProtocolPages = result.pages.filter((p: any) => !isProtocolPage(p.text));
      console.log(`[Unpdf Extractor] Excluídos ${result.pages.length - nonProtocolPages.length} de ${result.pages.length} páginas por serem identificadas como protocolo de acompanhamento.`);
      return nonProtocolPages.map((p: any) => p.text).join("\n");
    }

    // 2. Check if the text property is returned as an array representing pages
    const textVal = result.text;
    if (Array.isArray(textVal)) {
      const nonProtocolPageTexts = textVal.filter((pageStr: string) => !isProtocolPage(pageStr));
      console.log(`[Unpdf Extractor] Excluídos ${textVal.length - nonProtocolPageTexts.length} de ${textVal.length} blocos de página por filtro de protocolo.`);
      return nonProtocolPageTexts.join("\n");
    }

    // 3. Fallback to single text block (extractFieldsWithRegex will also apply line filters)
    if (typeof textVal === "string") {
      if (isProtocolPage(textVal)) {
        console.log(`[Unpdf Extractor] O texto completo do documento foi identificado como protocolo e descartado.`);
        return "";
      }
      return textVal;
    }

    return "";
  } catch (err: any) {
    console.error("[unpdf Extraction Error]", err);
    throw new Error(`Falha ao decodificar texto digital do PDF: ${err.message}`);
  }
}
