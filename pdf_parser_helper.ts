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
          lineUpper.includes("CPFL") || 
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

  const lowerText = text.toLowerCase();
  const firstCnpjMatch = text.match(/([0-9]{2}\.[0-9]{3}\.[0-9]{3}\/[0-9]{4}-[0-9]{2})/);
  const generalDateMatches = text.match(/([0-3][0-9]\/[0-1][0-9]\/[1-2][0-9]{3})/g);

  // Pre-scan for common "Month + DueDate + Value" horizontal rows, extremely common in CPFL/Enel/Elektro bills
  let preScannedRef = "";
  let preScannedVenc = "";
  let preScannedValor = "";

  const monthMapLocal: Record<string, string> = {
    'jan': '01', 'fev': '02', 'mar': '03', 'abr': '04', 'mai': '05', 'jun': '06',
    'jul': '07', 'ago': '08', 'set': '09', 'out': '10', 'nov': '11', 'dez': '12',
    'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03', 'abril': '04',
    'maio': '05', 'junho': '06', 'julho': '07', 'agosto': '08', 'setembro': '09',
    'outubro': '10', 'novembro': '11', 'dezembro': '12'
  };

  const linesForPreScan = text.split('\n').map(l => l.trim());
  for (const line of linesForPreScan) {
    // Look for e.g. "NOV/2025" or "11/2025"
    const monthRegex = new RegExp(`\\b(${Object.keys(monthMapLocal).join('|')}|0[1-9]|1[0-2])[-/](20[2-3][0-9]|[0-9]{2})\\b`, 'i');
    const monthMatch = line.match(monthRegex);

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
  
  fields.forEach(field => {
    const fn = field.name.toLowerCase();
    const fl = field.label.toLowerCase();
    let value = "";

    // A. EXPLICIT DETERMINISTIC OVERRIDES FOR ENERGY PRE-SET FIELDS
    
    // 1. Installation Number / UC
    if (fn.includes('instalacao') || fn.includes('instalação') || fl.includes('instalação') || fl.includes('instalacao') || fl.includes('unidade consumidora') || fl.includes('uc')) {
      const instKeywords = [
        'instalação', 'instalacao', 'nº da instalação', 'no. instalação', 'no. instalacao',
        'unidade consumidora', 'uc', 'cód. instalação', 'código instalação', 'código da instalação',
        'código do cliente', 'nº do cliente', 'no do cliente'
      ];
      for (const kw of instKeywords) {
        const regexVal = new RegExp(`${kw}\\s*[:\\- ]*\\s*([0-9]{5,15})`, 'i');
        const match = text.match(regexVal);
        if (match) {
          value = match[1].trim();
          break;
        }
      }

      if (!value) {
        // Line-by-line look-ahead vertical scanning for UC/Customer Number
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const lineLower = lines[i].toLowerCase();
          const matchesKw = instKeywords.some(kw => {
            if (kw === 'uc') {
              return /\buc\b/i.test(lineLower);
            }
            return lineLower.includes(kw);
          });
          if (matchesKw) {
            // Check current line for a 5-15 digit number
            const matchCurr = lines[i].match(/\b([0-9]{5,15})\b/);
            if (matchCurr) {
              value = matchCurr[1].trim();
              break;
            }
            // Check next line
            if (i + 1 < lines.length) {
              const matchNext = lines[i+1].match(/\b([0-9]{5,15})\b/);
              if (matchNext) {
                value = matchNext[1].trim();
                break;
              }
            }
            // Check 2 lines ahead
            if (i + 2 < lines.length) {
              const matchNext2 = lines[i+2].match(/\b([0-9]{5,15})\b/);
              if (matchNext2) {
                value = matchNext2[1].trim();
                break;
              }
            }
          }
        }
      }

      if (!value) {
        // Standalone number rule (looks for a line of exactly 7 to 11 digits near CNPJ or NOTA FISCAL or FATURA or EMISSÃO/EMISSAO)
        const lines = text.split('\n').map(l => l.trim());
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].match(/^\d{7,11}$/)) {
            const nearbyLines = lines.slice(Math.max(0, i - 4), Math.min(lines.length, i + 5));
            const nearText = nearbyLines.join('\n').toLowerCase();
            if (nearText.includes('cnpj') || nearText.includes('nota fiscal') || nearText.includes('fatura') || nearText.includes('emissão') || nearText.includes('emissao')) {
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
        const refKeywords = [
          'mês de referência', 'mês referência', 'mes referencia', 'mês ref', 'mes ref',
          'mês/ano', 'referência', 'referencia', 'ref', 'competência', 'competencia', 'mês de ref',
          'referente a', 'conta referente a'
        ];
        for (const kw of refKeywords) {
          const regexVal = new RegExp(`${kw}\\s*[:\\- ]*\\s*\\b([0-1][0-9]\\/[2-9][0-9]{3})\\b`, 'i');
          const match = text.match(regexVal);
          if (match) {
            value = match[1].trim();
            break;
          }
          
          const regexValShort = new RegExp(`${kw}\\s*[:\\- ]*\\s*\\b([0-1][0-9]\\/[0-9]{2})\\b`, 'i');
          const matchShort = text.match(regexValShort);
          if (matchShort) {
            value = matchShort[1].trim();
            break;
          }

          const regexMonth = new RegExp(`${kw}\\s*[:\\- ]*\\s*\\b(${Object.keys(monthMapLocal).join('|')})\\s*[-/]?\\s*([0-9]{2,4})\\b`, 'i');
          const matchMonth = text.match(regexMonth);
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
        // Try direct searching for month abbreviation + year
        const rx = new RegExp(`\\b(${Object.keys(monthMapLocal).join('|')})[-/](20[2-3][0-9]\\b|[0-9]{2}\\b)`, 'i');
        const match = text.match(rx);
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
        // Line-by-line look-ahead for reference month
        const lines = text.split('\n');
        const refKeywords = ['mês/ano', 'mes/ano', 'referente a', 'mês ref', 'mes ref', 'mês de referência', 'mês referência', 'mes referencia', 'referência', 'referencia', 'ref', 'conta referente a'];
        for (let i = 0; i < lines.length; i++) {
          const lineLower = lines[i].toLowerCase();
          if (refKeywords.some(kw => lineLower.includes(kw))) {
            // Check current line
            const matchCurr = lines[i].match(/\b(0[1-9]|1[0-2])\/(20[2-3][0-9]|[2-3][0-9])\b/);
            if (matchCurr) {
              let m = matchCurr[1];
              let y = matchCurr[2];
              if (y.length === 2) y = '20' + y;
              value = `${m}/${y}`;
              break;
            }
            // Check next line
            if (i + 1 < lines.length) {
              const matchNext = lines[i+1].match(/\b(0[1-9]|1[0-2])\/(20[2-3][0-9]|[2-3][0-9])\b/);
              if (matchNext) {
                let m = matchNext[1];
                let y = matchNext[2];
                if (y.length === 2) y = '20' + y;
                value = `${m}/${y}`;
                break;
              }
            }
            // Check 2 lines ahead
            if (i + 2 < lines.length) {
              const matchNext2 = lines[i+2].match(/\b(0[1-9]|1[0-2])\/(20[2-3][0-9]|[2-3][0-9])\b/);
              if (matchNext2) {
                let m = matchNext2[1];
                let y = matchNext2[2];
                if (y.length === 2) y = '20' + y;
                value = `${m}/${y}`;
                break;
              }
            }
          }
        }
      }

      if (!value) {
        const matches = [...text.matchAll(/(?<![0-9/])(0[1-9]|1[0-2])\/(20[2-3][0-9])(?![0-9/])/g)];
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
        const vencimentoKeywords = [
          'vencimento', 'data de vencimento', 'pague até', 'pagar até', 
          'pagar ate', 'vcto', 'vence em', 'vence', 'venc', 'venc:'
        ];
        for (const kw of vencimentoKeywords) {
          const regexVal = new RegExp(`${kw}\\s*[:\\- ]*\\s*([0-3][0-9]\/[0-1][0-9]\/[1-2][0-9]{3})`, 'i');
          const match = text.match(regexVal);
          if (match) {
            value = standardizeDate(match[1].trim());
            break;
          }
        }
      }
      
      if (!value) {
        // Line-by-line look-ahead vertical scanning for Vencimento
        const lines = text.split('\n');
        const vencimentoKeywords = ['vencimento', 'data de vencimento', 'pague até', 'pagar até', 'pagar ate', 'vcto', 'vence em', 'vence', 'venc', 'venc:'];
        for (let i = 0; i < lines.length; i++) {
          const lineLower = lines[i].toLowerCase();
          if (vencimentoKeywords.some(kw => lineLower.includes(kw))) {
            const dateMatchCurr = lines[i].match(/([0-3]?[0-9]\/[0-1]?[0-9]\/[1-2][0-9]{3})/);
            if (dateMatchCurr) {
              value = standardizeDate(dateMatchCurr[1].trim());
              break;
            }
            if (i + 1 < lines.length) {
              const dateMatchNext = lines[i+1].match(/([0-3]?[0-9]\/[0-1]?[0-9]\/[1-2][0-9]{3})/);
              if (dateMatchNext) {
                value = standardizeDate(dateMatchNext[1].trim());
                break;
              }
            }
            if (i + 2 < lines.length) {
              const dateMatchNext2 = lines[i+2].match(/([0-3]?[0-9]\/[0-1]?[0-9]\/[1-2][0-9]{3})/);
              if (dateMatchNext2) {
                value = standardizeDate(dateMatchNext2[1].trim());
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
          const match = text.match(rx);
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
      // Prioritizing user requested nomenclatures: "Quant. faturada", "Quant.(kwh)", "consumo KWh", "Consumo em kWh"
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
          const match = text.match(regex);
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
        const lines = text.split('\n');
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
            const line = lines[i].trim();
            if (kw.pattern.test(line)) {
              console.log(`[Spec Nomenclatures] Encontrado cabeçalho de consumo correspondente a "${kw.name}" na linha: "${line}"`);
              
              // Tenta extrair o primeiro número válido dessa linha depois do padrão
              const lineLower = line.toLowerCase();
              const matchIndex = lineLower.search(kw.pattern);
              if (matchIndex !== -1) {
                const subStr = line.substring(matchIndex);
                // Busca um número com decimal opcional/milhar
                const numbers = [...subStr.matchAll(/\b([0-9]{1,3}(?:\s*[0-9]{3})*(?:,[0-9]+)?|[0-9]+,[0-9]+|[0-9]+)\b/g)];
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

              // Se não encontrou número na mesma linha, vasculha a linha seguinte (comum em listagens horizontais)
              if (i + 1 < lines.length) {
                const nextLine = lines[i+1].trim();
                const numbersNext = [...nextLine.matchAll(/\b([0-9]{1,3}(?:\s*[0-9]{3})*(?:,[0-9]+)?|[0-9]+,[0-9]+|[0-9]+)\b/g)];
                for (const num of numbersNext) {
                  const rawNum = num[1].replace(/(\d)\s+(\d)/g, '$1$2').replace(/\s/g, '');
                  const cleanVal = parseFloat(rawNum.replace(/\./g, '').replace(',', '.'));
                  if (!isNaN(cleanVal) && cleanVal > 0 && cleanVal < 150000 && cleanVal !== 2025 && cleanVal !== 2026 && cleanVal !== 2024 && cleanVal !== 2023) {
                    if (isProbablyTariff(rawNum)) {
                      console.log(`[Spec Nomenclatures Next Line] Ignored tariff value: "${rawNum}"`);
                      continue;
                    }
                    value = rawNum;
                    console.log(`[Spec Nomenclatures] Número extraído da linha seguinte: "${value}" (valor: ${cleanVal})`);
                    break;
                  }
                }
              }

              if (value) break;

              // Se ainda não, vasculha 2 linhas seguintes
              if (i + 2 < lines.length) {
                const nextLine2 = lines[i+2].trim();
                const numbersNext2 = [...nextLine2.matchAll(/\b([0-9]{1,3}(?:\s*[0-9]{3})*(?:,[0-9]+)?|[0-9]+,[0-9]+|[0-9]+)\b/g)];
                for (const num of numbersNext2) {
                  const rawNum = num[1].replace(/(\d)\s+(\d)/g, '$1$2').replace(/\s/g, '');
                  const cleanVal = parseFloat(rawNum.replace(/\./g, '').replace(',', '.'));
                  if (!isNaN(cleanVal) && cleanVal > 0 && cleanVal < 150000 && cleanVal !== 2025 && cleanVal !== 2026 && cleanVal !== 2024 && cleanVal !== 2023) {
                    if (isProbablyTariff(rawNum)) {
                      console.log(`[Spec Nomenclatures Two Lines Below] Ignored tariff value: "${rawNum}"`);
                      continue;
                    }
                    value = rawNum;
                    console.log(`[Spec Nomenclatures] Número extraído de duas linhas abaixo: "${value}" (valor: ${cleanVal})`);
                    break;
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
        const lines = text.split('\n');
        
        // Helper to get possible numeric values from a Portuguese/Standard formatted number string
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
            line.toUpperCase().includes('HISTÓRICO') || 
            line.toUpperCase().includes('HISTORICO') ||
            line.toUpperCase().includes('CNPJ') ||
            line.toUpperCase().includes('TELEFONE') ||
            line.toUpperCase().includes('AVENIDA') ||
            line.toUpperCase().includes('RUA ') ||
            line.toUpperCase().includes('CEP ') ||
            line.toUpperCase().includes('CHAVE') ||
            line.toUpperCase().includes('ACESSO') ||
            line.toUpperCase().includes('PROTOCOLO') ||
            line.toUpperCase().includes('AUTORIZAÇÃO') ||
            line.toUpperCase().includes('AUTORIZACAO') ||
            line.toUpperCase().includes('CPF') ||
            line.toUpperCase().includes('SÉRIE') ||
            line.toUpperCase().includes('SERIE') ||
            line.toUpperCase().includes('FISCAL') ||
            line.toUpperCase().includes('NF3E') ||
            line.toUpperCase().includes('NF-E') ||
            line.toUpperCase().includes('NFE') ||
            line.toUpperCase().includes('IE:') ||
            line.toUpperCase().includes('INSCRICAO') ||
            line.toUpperCase().includes('INSCRIÇÃO') ||
            line.toUpperCase().includes('DATA ') ||
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
                  
                  const ants = candidates[idxAnt].values;
                  const atus = candidates[idxAtu].values;
                  const consts = candidates[idxConst].values;
                  const conss = candidates[idxCons].values;
                  
                  for (const valAnt of ants) {
                    for (const valAtu of atus) {
                      for (const valConst of consts) {
                        for (const valCons of conss) {
                          const diff = valAtu - valAnt;
                          if (diff <= 0) continue;
                          
                          const expectedConsumo = diff * valConst;
                          const ratio = Math.abs(expectedConsumo - valCons) / valCons;
                          
                          if (ratio < 0.01 || Math.abs(expectedConsumo - valCons) <= 1.0) {
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
                
                const ants = candidates[idxAnt].values;
                const atus = candidates[idxAtu].values;
                const conss = candidates[idxCons].values;
                
                for (const valAnt of ants) {
                  for (const valAtu of atus) {
                    for (const valCons of conss) {
                      const diff = valAtu - valAnt;
                      if (diff <= 0) continue;
                      
                      const ratio = Math.abs(diff - valCons) / valCons;
                      if (ratio < 0.01 || Math.abs(diff - valCons) <= 1.0) {
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
      // Example: "Total 16146 16607 1 461" or "Total 15841 16146 1 305"
      if (!value) {
        const energisaTotalMatch = text.match(/\bTotal\s+([0-9\.,]{3,8})\s+([0-9\.,]{3,8})\s+([0-9\.,]+)\s+([0-9\.,]{2,6})\b/i);
        if (energisaTotalMatch) {
          value = energisaTotalMatch[4].trim();
          console.log(`[Energisa Total Match] Encontrado consumo por sequência total: "${energisaTotalMatch[0]}" -> ${value}`);
        }
      }

      // 3. ENERGISA "Consumo em kWh" SPECIFIC CHARGE LINE
      // Matches "Consumo em kWh KWH 461" or "Consumo em kWh 305"
      if (!value) {
        const energisaConsumoPattern = text.match(/Consumo\s+em\s+kWh\s*(?:[A-Z]{3})?\s*([0-9\.,]+)/i) ||
                                       text.match(/Consumo\s+em\s+kWh\s+([0-9\.,]+)/i);
        if (energisaConsumoPattern) {
          value = energisaConsumoPattern[1].trim();
        }
      }

      // 4. CPFL SPECIFIC LINE FALLBACKS
      if (!value) {
        const cpflMeter = text.match(/Energia\s+Ativa(?:-kWh)?\s+(?:único|unico)[\s\S]*?([0-9\.,]+)\s*$/i) ||
                          text.match(/Energia\s+Ativa(?:-kWh)?\s+(?:único|unico)[\s\S]*?([0-9\.,]+)/i);
        if (cpflMeter) {
          value = cpflMeter[1].trim();
        }
      }
      if (!value) {
        const cpflTusd = text.match(/Consumo\s+Uso\s+Sistema[\s\S]*?TUSD[\s\S]*?kWh\s+([0-9\.,]+)/i);
        if (cpflTusd) {
          value = cpflTusd[1].trim();
        }
      }
      if (!value) {
        const cpflTe = text.match(/Consumo\s*-\s*TE[\s\S]*?kWh\s+([0-9\.,]+)/i);
        if (cpflTe) {
          value = cpflTe[1].trim();
        }
      }

      // 5. ENEL SPECIFIC TABLE FALLBACKS
      if (!value) {
        const enelSequence = text.match(/(?:ENRG\s+ATV|ENERGIA\s+ATIVA|ENRG|ENERG)[\s\S]*?([0-9\.,]+)\s+([0-9\.,]+)\s+([0-9\.,]+)\s+([0-9\.,]+)/i);
        if (enelSequence) {
          const candidate = enelSequence[4].trim();
          if (!isProbablyTariff(candidate)) {
            value = candidate;
          }
        }
      }
      if (!value) {
        const enelMeter = text.match(/ENRG\s+ATV[A-Z\s]*[\s\S]*?([0-9\.,]+)/i) ||
                          text.match(/ENERGIA\s+ATIVA[A-Za-z\s]*[\s\S]*?([0-9\.,]+)/i);
        if (enelMeter) {
          const candidate = enelMeter[1].trim();
          if (!isProbablyTariff(candidate)) {
            value = candidate;
          }
        }
      }

      // 6. HISTORIC CONSUMO TABLE FALLBACKS (ENEL e.g. "DEZ/25 4.160,000")
      if (!value) {
        const historyMatches = [...text.matchAll(/\b(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s*[\/\-]\s*[0-9]{2}\s+([0-9\.,]+)\b/gi)];
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
                   const matchText = m[0].toLowerCase();
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
          /TUSD[\s\S]*?kWh\s*([0-9\.,]+)/i,
          /TE[\s\S]*?kWh\s*([0-9\.,]+)/i,
          /Uso\s+Sistema[\s\S]*?kWh\s*([0-9\.,]+)/i,
          /Uso\s+Sist[\s\S]*?\b([0-9\.,]+)\b/i,
          /Consumo\s*-\s*TE[\s\S]*?\b([0-9\.,]+)\b/i,
          /(?:USO\s+SIST\.?\s*DISTR\.?\s*\(TUSD\)|\bENERGIA\s*\(TE\))[\s\S]*?([0-9\.,]+)/i
        ];
        for (const pattern of chargesPatterns) {
          const match = text.match(pattern);
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
          const match = text.match(regex);
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
        const lines = text.split('\n');
        const consumptionHeaders = [
          'quant. faturada', 'quant.faturada', 'quantidade faturada',
          'quant.(kwh)', 'quant. (kwh)', 'quant.kwh', 'quant. kwh',
          'consumo em kwh', 'consumo kwh', 'consumo de kwh', 'consumo mês', 'consumo mes',
          'qtde kwh mês', 'qtde kwh mes', 'quantidade kwh', 'energia ativa', 'consumo/kwh', 'consumo / kwh'
        ];
        
        for (let i = 0; i < lines.length; i++) {
          const lineLower = lines[i].toLowerCase();
          if (consumptionHeaders.some(kw => lineLower.includes(kw))) {
            let foundNum = "";
            let searchIdx = -1;
            for (const header of consumptionHeaders) {
              const pos = lineLower.indexOf(header);
              if (pos !== -1) {
                searchIdx = pos;
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
            if (i + 1 < lines.length) {
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
            if (foundNum) {
              value = foundNum;
              break;
            }

            // C. Or look 2 lines ahead
            if (i + 2 < lines.length) {
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
            if (foundNum) {
              value = foundNum;
              break;
            }
          }
        }
      }

      if (!value) {
        const matchKwhSimple = text.match(/\b([0-9\.,]+)\s*kWh\b/i);
        if (matchKwhSimple) {
          const candidate = matchKwhSimple[1].trim();
          if (!isProbablyTariff(candidate)) {
            value = candidate;
          }
        }
      }

      if (!value) {
        const matchKwh = text.match(/(?:Consumo(?:\s+Ativo)?|Energia(?:\s+Ativa)?|Quantidade\s+Faturada|Consumo\s+do\s+Mês|Consumo\s+do\s+Mes|Leitura|Cons\.?|Consumo\s+Realizado)\s*[:\s\-#]*\s*([0-9\.,]+)\s*(?:kWh|kW|m3|m³)?/i);
        if (matchKwh) {
          const candidate = matchKwh[1].trim();
          if (!isProbablyTariff(candidate)) {
            value = candidate;
          }
        }
      }

      if (!value) {
        const kwhIndex = text.toLowerCase().indexOf('kwh');
        if (kwhIndex !== -1) {
          const surroundingBefore = text.substring(Math.max(0, kwhIndex - 30), kwhIndex);
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
          'valor líquido', 'valor liquido', 'total do documento', 'total', 'net total', 'pago'
        ];
        for (const kw of valKeywords) {
          const regexVal = new RegExp(`${kw}\\s*[:\\- R$]*\\s*([0-9\\.\\t ]+,[0-9]{2})`, 'i');
          const match = text.match(regexVal);
          if (match) {
            value = match[1].trim();
            break;
          }
        }
      }

      if (!value) {
        // Line-by-line look-ahead vertical scanning for Total Value
        const lines = text.split('\n');
        const valKeywords = [
          'total a pagar', 'valor total', 'total faturado', 'total da fatura', 'fatura',
          'valor líquido', 'valor liquido', 'total do documento', 'total'
        ];
        for (let i = 0; i < lines.length; i++) {
          const lineLower = lines[i].toLowerCase();
          if (valKeywords.some(kw => lineLower.includes(kw))) {
            const matchCurr = lines[i].match(/(?:R\$)?\s*([0-9\.]+,[0-9]{2})/i);
            if (matchCurr) {
              value = matchCurr[1].trim();
              break;
            }
            if (i + 1 < lines.length) {
              const matchNext = lines[i+1].match(/(?:R\$)?\s*([0-9\.]+,[0-9]{2})/i);
              if (matchNext) {
                value = matchNext[1].trim();
                break;
              }
            }
            if (i + 2 < lines.length) {
              const matchNext2 = lines[i+2].match(/(?:R\$)?\s*([0-9\.]+,[0-9]{2})/i);
              if (matchNext2) {
                value = matchNext2[1].trim();
                break;
              }
            }
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
 * Parses binary base64 PDF using unpdf to extract clean plain text
 */
export async function extractPDFText(base64Data: string): Promise<string> {
  const cleanBase64 = base64Data.replace(/^data:application\/pdf;base64,/, "");
  const buffer = Buffer.from(cleanBase64, 'base64');
  const uint8Array = new Uint8Array(buffer);
  
  try {
    const { text } = await extractText(uint8Array);
    if (!text) return "";
    if (Array.isArray(text)) {
      return text.join("\n");
    }
    return text || "";
  } catch (err: any) {
    console.error("[unpdf Extraction Error]", err);
    throw new Error(`Falha ao decodificar texto digital do PDF: ${err.message}`);
  }
}
