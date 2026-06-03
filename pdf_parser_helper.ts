// @ts-ignore
import * as pdf from 'pdf-parse';

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
 * Tries parsing digital text directly with deterministic regex matchers
 */
export function extractFieldsWithRegex(text: string, fields: ExtractionField[]): Record<string, any> {
  const result: Record<string, any> = {};

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
  
  fields.forEach(field => {
    const fn = field.name.toLowerCase();
    const fl = field.label.toLowerCase();
    let value = "";

    // A. EXPLICIT DETERMINISTIC OVERRIDES FOR ENERGY PRE-SET FIELDS
    
    // 1. Installation Number
    if (fn.includes('instalacao') || fn.includes('instalação') || fl.includes('instalação') || fl.includes('instalacao') || fl.includes('unidade consumidora') || fl.includes('uc')) {
      const instKeywords = [
        'instalação', 'instalacao', 'nº da instalação', 'no. instalação', 'no. instalacao',
        'unidade consumidora', 'uc', 'cód. instalação', 'código instalação', 'código da instalação'
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
        // Line contextual scanning
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const lineLower = lines[i].toLowerCase();
          if (instKeywords.some(kw => lineLower.includes(kw))) {
            const numMatch = lines[i].match(/\b([0-9]{5,15})\b/);
            if (numMatch) {
              value = numMatch[1];
              break;
            }
            if (i + 1 < lines.length) {
              const numMatchNext = lines[i+1].match(/\b([0-9]{5,15})\b/);
              if (numMatchNext) {
                value = numMatchNext[1];
                break;
              }
            }
          }
        }
      }
    }
    // 2. Month Reference (Mês de referência)
    else if (fn.includes('mes_referencia') || fn.includes('mês_referencia') || fl.includes('mês referência') || fl.includes('mes referencia') || fl.includes('referência') || fl.includes('referencia') || fl.includes('mês/ano')) {
      const refKeywords = [
        'mês de referência', 'mês referência', 'mes referencia', 'mês ref', 'mes ref',
        'mês/ano', 'referência', 'referencia', 'ref', 'competência', 'competencia', 'mês de ref'
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

        const regexMonth = new RegExp(`${kw}\\s*[:\\- ]*\\s*\\b(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\\s*[-/]?\\s*([0-9]{2,4})\\b`, 'i');
        const matchMonth = text.match(regexMonth);
        if (matchMonth) {
          value = `${matchMonth[1].toUpperCase()}/${matchMonth[2]}`;
          break;
        }
      }

      if (!value) {
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const lineLower = lines[i].toLowerCase();
          if (refKeywords.some(kw => lineLower.includes(kw))) {
            const dateMatch = lines[i].match(/\b(0[1-9]|1[0-2])\/(20[2-3][0-9])\b/);
            if (dateMatch) {
              value = dateMatch[0];
              break;
            }
            if (i + 1 < lines.length) {
              const dateMatchNext = lines[i+1].match(/\b(0[1-9]|1[0-2])\/(20[2-3][0-9])\b/);
              if (dateMatchNext) {
                value = dateMatchNext[0];
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
      
      if (!value) {
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const lineLower = lines[i].toLowerCase();
          if (vencimentoKeywords.some(kw => lineLower.includes(kw))) {
            const dateMatchCurr = lines[i].match(/([0-3][0-9]\/[0-1][0-9]\/[1-2][0-9]{3})/);
            if (dateMatchCurr) {
              value = standardizeDate(dateMatchCurr[1].trim());
              break;
            }
            if (i + 1 < lines.length) {
              const dateMatchNext = lines[i+1].match(/([0-3][0-9]\/[0-1][0-9]\/[1-2][0-9]{3})/);
              if (dateMatchNext) {
                value = standardizeDate(dateMatchNext[1].trim());
                break;
              }
            }
          }
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
      const headerPatterns = [
        'consumo mês / kwh',
        'consumo mes / kwh',
        'consumo mês/kwh',
        'consumo mes/kwh',
        'consumo mês',
        'consumo mes',
        'qtde kwh mês',
        'qtde kwh mes',
        'quantidade kwh',
        'energia ativa'
      ];

      let foundHeaderPos = -1;
      for (const pattern of headerPatterns) {
        const idx = lowerText.indexOf(pattern);
        if (idx !== -1) {
          foundHeaderPos = idx;
          break;
        }
      }

      if (foundHeaderPos !== -1) {
        const searchPortion = text.substring(foundHeaderPos, foundHeaderPos + 150);
        const matches = [...searchPortion.matchAll(/\b([0-9\.,]+)\b/g)];
        for (const m of matches) {
          const rawNum = m[1];
          if (rawNum && !rawNum.includes('/') && !rawNum.includes('-')) {
            const cleanVal = parseFloat(rawNum.replace(/\./g, '').replace(',', '.'));
            if (!isNaN(cleanVal) && cleanVal > 0 && cleanVal < 200000 && cleanVal !== 2025 && cleanVal !== 2026) {
              const textBeforeNum = searchPortion.substring(0, searchPortion.indexOf(rawNum));
              if (!textBeforeNum.includes('R$') && !textBeforeNum.toLowerCase().includes('vencimento')) {
                value = rawNum;
                break;
              }
            }
          }
        }
      }

      if (!value) {
        const matchKwhSimple = text.match(/\b([0-9\.,]+)\s*kWh\b/i);
        if (matchKwhSimple) {
          value = matchKwhSimple[1].trim();
        }
      }

      if (!value) {
        const matchKwh = text.match(/(?:Consumo(?:\s+Ativo)?|Energia(?:\s+Ativa)?|Quantidade\s+Faturada|Consumo\s+do\s+Mês|Consumo\s+do\s+Mes|Leitura|Cons\.?|Consumo\s+Realizado)\s*[:\s\-#]*\s*([0-9\.,]+)\s*(?:kWh|kW|m3|m³)?/i);
        if (matchKwh) {
          value = matchKwh[1].trim();
        }
      }

      if (!value) {
        const kwhIndex = text.toLowerCase().indexOf('kwh');
        if (kwhIndex !== -1) {
          const surroundingBefore = text.substring(Math.max(0, kwhIndex - 30), kwhIndex);
          const numMatch = surroundingBefore.match(/\b([0-9\.,]+)\s*$/);
          if (numMatch) {
            value = numMatch[1].trim();
          }
        }
      }

      if (value) {
        let cleaned = value.trim();
        if (cleaned.includes(',') && cleaned.includes('.')) {
          cleaned = cleaned.replace(/\./g, '').replace(',', '.');
        } else if (cleaned.includes(',')) {
          cleaned = cleaned.replace(',', '.');
        }
        cleaned = cleaned.replace(/[^0-9.]/g, '');
        value = cleaned;
      }
    }
    // 5. Total Value
    else if (fn.includes('valor_total') || fn.includes('total_fatura') || fl.includes('valor total') || fl.includes('total') || field.type === 'currency') {
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
 * Parses binary base64 PDF using pdf-parse to extract clean plain text
 */
export async function extractPDFText(base64Data: string): Promise<string> {
  const cleanBase64 = base64Data.replace(/^data:application\/pdf;base64,/, "");
  const buffer = Buffer.from(cleanBase64, 'base64');
  
  try {
    const pdfModule = pdf as any;
    const parse = (pdfModule.default || pdfModule);
    const data = await parse(buffer);
    return data.text || "";
  } catch (err: any) {
    console.error("[PDF Extraction Error]", err);
    throw new Error(`Falha ao decodificar texto digital do PDF: ${err.message}`);
  }
}
