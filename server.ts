import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { extractPDFText, extractFieldsWithRegex, standardizeDate } from "./pdf_parser_helper.js";

dotenv.config();

// Ensure Gemini Client is initialized with process.env.GEMINI_API_KEY or custom key
// Use lazy instantiation or wrap it carefully so we handle missing keys gracefully.
let ai: GoogleGenAI | null = null;
let geminiApiKey = "";
let activeGeminiApiKeyUsed = "";

function getGeminiClient(): GoogleGenAI {
  const currentKey = geminiApiKey || process.env.GEMINI_API_KEY;
  if (!currentKey) {
    throw new Error("GEMINI_API_KEY não foi configurada nos Secrets da aplicação ou fornecida pelo usuário. Adicione a sua Chave de API nas Configurações Avançadas.");
  }
  if (!ai || activeGeminiApiKeyUsed !== currentKey) {
    ai = new GoogleGenAI({
      apiKey: currentKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    activeGeminiApiKeyUsed = currentKey;
  }
  return ai;
}

// Helper function to call Gemini with automatic exponential backoff retry on HTTP 429 / Quota Errors and HTTP 503 / High Demand
async function callGeminiWithRetry(
  gemini: GoogleGenAI, 
  params: any, 
  maxRetries = 6,
  onRetry?: (msg: string) => void
): Promise<any> {
  let attempt = 0;
  let delay = 3000; // start with 3 seconds
  let currentModel = params.model || 'gemini-3.5-flash';

  while (true) {
    try {
      // Create a shallow copy with the active model (allowing backup transition)
      const queryParams = { ...params, model: currentModel };
      return await gemini.models.generateContent(queryParams);
    } catch (error: any) {
      attempt++;
      
      const errorMessage = error?.message || "";
      const status = error?.status || error?.statusCode || 0;
      
      const isRateLimit = status === 429 || 
                          errorMessage.includes("429") ||
                          errorMessage.includes("Quota exceeded") ||
                          errorMessage.includes("RESOURCE_EXHAUSTED") ||
                          errorMessage.includes("rate-limits") ||
                          errorMessage.includes("limit: 20");

      const isTransient = status === 503 || 
                          status === 504 ||
                          status === 500 ||
                          errorMessage.includes("503") ||
                          errorMessage.includes("UNAVAILABLE") ||
                          errorMessage.includes("high demand") ||
                          errorMessage.includes("temporary") ||
                          errorMessage.includes("Service Unavailable") ||
                          errorMessage.includes("504");
      
      if ((isRateLimit || isTransient) && attempt <= maxRetries) {
        let sleepMs = delay;
        
        if (isRateLimit) {
          // Para limite de quotas do plano grátis (429), pausamos taticamente por mais tempo para girar a janela de tempo (geralmente de 1 min)
          sleepMs = Math.min(45000, (15 + attempt * 6) * 1000); // Ex: 1ª vez: 21s, 2ª vez: 27s ... teto de 45s
          onRetry?.(`Prevenção de Cota Gratuita (429). Aguardando ${sleepMs / 1000}s para resetar janela de cota do Gemini (Tentativa ${attempt}/${maxRetries})...`);
        } else if (isTransient) {
          // Para desvios de alta demanda (503), uma pequena pausa e alternância de modelo resolvem rápido
          sleepMs = Math.min(30000, (7 + attempt * 4) * 1000); // teto de 30s
          
          if (currentModel === 'gemini-3.5-flash') {
            currentModel = 'gemini-3.1-flash-lite';
          } else {
            currentModel = 'gemini-3.5-flash';
          }
          onRetry?.(`Instabilidade temporária (503). Mudando para o modelo [${currentModel}] em ${sleepMs / 1000}s...`);
        }

        try {
          // Attempt to extract requested delay from error text, e.g. "Please retry in 32.345035661s." or "retryDelay":"32s"
          const secondsMatch = errorMessage.match(/retry in\s+([\d.]+)\s*s/i) || 
                               errorMessage.match(/retryDelay":"?(\d+)/i) || 
                               errorMessage.match(/(\d+)s/i);
          if (secondsMatch && secondsMatch[1]) {
            const parsedSeconds = parseFloat(secondsMatch[1]);
            if (!isNaN(parsedSeconds)) {
              // Sleep for the exact required seconds + a 2-second safety buffer
              sleepMs = (parsedSeconds + 2) * 1000;
            }
          }
        } catch (e) {
          // Fallback to exponential delay
        }

        console.warn(`[Gemini API Retry] Falha temporária ou cota atingida. Tentativa ${attempt}/${maxRetries}. Aguardando ${sleepMs / 1000}s com modelo ${currentModel}...`);
        
        // Contagem regressiva ativa enviando status dinâmico para o polling do frontend
        const step = 1000;
        let remaining = sleepMs;
        while (remaining > 0) {
          onRetry?.(
            isRateLimit
              ? `Aguardando ${(remaining / 1000).toFixed(0)}s para girar cota gratuita (Tentativa ${attempt}/${maxRetries}...). Seus 300 arquivos estão seguros!`
              : `Alternando para o modelo reserva [${currentModel}] em ${(remaining / 1000).toFixed(0)}s por flutuação global...`
          );
          await new Promise(resolve => setTimeout(resolve, Math.min(step, remaining)));
          remaining -= step;
        }
        
        // Exponentially increase backend scale delay for next try (capped at 60s)
        delay = Math.min(60000, delay * 2 + Math.floor(Math.random() * 2000));
        continue;
      }

      throw error;
    }
  }
}

// In-memory structured Types (aligned with/src/types.ts)
interface ExtractionField {
  id: string;
  name: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'currency';
  description: string;
  required: boolean;
}

interface ServerQueueItem {
  id: string;
  fileName: string;
  fileSize: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  error?: string;
  retryMessage?: string;
  extractedData?: Record<string, any>;
  rawSummary?: string;
  uploadedAt: string;
  processedAt?: string;
  extractionMethod?: 'direct' | 'ai' | 'ocr-space' | 'ocr-space-only' | 'google-vision' | 'google-vision-only';
  fields: ExtractionField[]; // Store fields to extract
}

// Global In-Memory queue
const queue: ServerQueueItem[] = [];
const fileContentsMap = new Map<string, string>(); // id -> base64
let activeWorkers = 0;
let maxConcurrency = 1; // Default to 1 (economic/free plan auto-scaled)
let queueDelayMs = 4500; // Default cooldown delay 4.5s between files to safely stay standard below 15 RPM (free tier limits)
let extractionMode: 'hybrid' | 'direct' | 'ai' | 'ocr-space' | 'ocr-space-only' | 'google-vision' | 'google-vision-only' = 'ocr-space-only';
let isQueuePaused = false;
let maxRetries = 3; // sensible default max attempts, to allow fast failover and not block on a stuck file
let ocrApiKey = "K88221884388957";
let ocrEngine = "2";
let ocrLanguage = "por";
let googleVisionApiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY || "";
let adminPassword = process.env.ADMIN_PASSWORD || "";

async function performGoogleVisionOcr(
  base64Data: string,
  fileName: string,
  apiKey: string
): Promise<string> {
  if (!apiKey) {
    throw new Error("Chave de API do Google Cloud Vision não configurada. Configure a chave nas Configurações Avançadas para poder usar esta opção.");
  }

  const isPdf = fileName.toLowerCase().endsWith(".pdf");
  
  // Clean raw base64 data to get exact pure data blocks
  let cleanBase64 = base64Data;
  const base64PartsMatch = base64Data.match(/^data:([^;]+);base64,(.*)$/);
  if (base64PartsMatch) {
    cleanBase64 = base64PartsMatch[2];
  } else {
    cleanBase64 = base64Data.replace(/^data:application\/pdf;base64,/, "")
                            .replace(/^data:image\/png;base64,/, "")
                            .replace(/^data:image\/jpeg;base64,/, "")
                            .replace(/^data:image\/jpg;base64,/, "")
                            .replace(/^data:image\/webp;base64,/, "");
  }

  if (isPdf) {
    const endpoint = `https://vision.googleapis.com/v1/files:annotate?key=${apiKey}`;
    const payload = {
      requests: [
        {
          inputConfig: {
            content: cleanBase64,
            mimeType: "application/pdf"
          },
          features: [
            {
              type: "DOCUMENT_TEXT_DETECTION"
            }
          ],
          pages: [1, 2, 3, 4, 5] // Annotate up to first 5 pages mapping
        }
      ]
    };

    console.log(`[Google Vision API] Chamando files:annotate para ${fileName}`);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Google Vision API (files:annotate) falhou com status ${response.status}: ${response.statusText}`);
    }

    const data: any = await response.json();
    if (data.error) {
      throw new Error(`Google Vision API retornou erro: ${data.error.message || JSON.stringify(data.error)}`);
    }

    const fileResponses = data.responses;
    if (!fileResponses || !Array.isArray(fileResponses) || fileResponses.length === 0) {
      throw new Error("Nenhuma resposta recebida do Google Vision API para o arquivo PDF.");
    }

    const pageResponses = fileResponses[0].responses;
    if (!pageResponses || !Array.isArray(pageResponses) || pageResponses.length === 0) {
      throw new Error("O Google Vision API não retornou páginas processadas para o arquivo PDF.");
    }

    const texts = pageResponses
      .map((pr: any) => pr.fullTextAnnotation?.text || "")
      .filter((t: string) => t.length > 0);

    if (texts.length === 0) {
      throw new Error("O Google Vision API retornou páginas processadas, mas nenhum texto pôde ser extraído.");
    }

    return texts.join("\n");
  } else {
    const endpoint = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;
    const payload = {
      requests: [
        {
          image: {
            content: cleanBase64
          },
          features: [
            {
              type: "DOCUMENT_TEXT_DETECTION"
            }
          ]
        }
      ]
    };

    console.log(`[Google Vision API] Chamando images:annotate para ${fileName}`);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Google Vision API (images:annotate) falhou com status ${response.status}: ${response.statusText}`);
    }

    const data: any = await response.json();
    if (data.error) {
      throw new Error(`Google Vision API retornou erro: ${data.error.message || JSON.stringify(data.error)}`);
    }

    const responses = data.responses;
    if (!responses || !Array.isArray(responses) || responses.length === 0) {
      throw new Error("Nenhuma resposta recebida do Google Vision API para a imagem.");
    }

    const extractedText = responses[0].fullTextAnnotation?.text || "";
    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error("O Google Vision API não conseguiu identificar nenhum texto legível nesta imagem.");
    }

    return extractedText;
  }
}


async function performOcrSpace(
  base64Data: string,
  apiKey: string,
  engine: string = "2",
  language: string = "por"
): Promise<string> {
  const endpoint = "https://api.ocr.space/parse/image";

  // Ensure base64Data is properly prefixed (ocr.space wants prefix)
  let formattedBase64 = base64Data;
  if (!base64Data.startsWith("data:")) {
    // If no prefix, default to image/jpeg prefix
    formattedBase64 = `data:image/jpeg;base64,${base64Data}`;
  }

  // Construct URLSearchParams
  const params = new URLSearchParams();
  params.append("apikey", apiKey);
  params.append("base64Image", formattedBase64);
  params.append("OCREngine", engine);
  params.append("language", language);
  params.append("isOverlayRequired", "false");
  params.append("scale", "true");

  console.log(`[ocr.space] Iniciando requisição para ${endpoint} usando Engine: ${engine} e Idioma: ${language}`);
  
  let attempts = 0;
  const maxOcrAttempts = 4;

  while (attempts < maxOcrAttempts) {
    attempts++;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      if (!response.ok) {
        if (response.status === 429 && attempts < maxOcrAttempts) {
          const waitTime = attempts * 3000 + Math.floor(Math.random() * 2000);
          console.warn(`[ocr.space] Status 429 (Too Many Requests). Aguardando ${waitTime}ms para tentar novamente (Tentativa ${attempts}/${maxOcrAttempts})...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        if (response.status === 413) {
          throw new Error("O arquivo enviado é grande demais para a API do ocr.space (Limite máximo: 1MB). DICA: Para arquivos maiores que 1MB, altere o Perfil de Extração no painel superior para 'Híbrido' (Padrão) ou 'Apenas IA (Gemini)'. O Gemini processa PDFs ou imagens de até 20MB de forma instantânea e com precisão profissional, sem esse limite de tamanho!");
        }
        throw new Error(`Erro na rede da API ocr.space: status ${response.status} (${response.statusText})`);
      }

      const result: any = await response.json();

      if (result.IsErroredOnProcessing) {
        const errorDetails = (Array.isArray(result.ErrorMessage) ? result.ErrorMessage.join(", ") : result.ErrorMessage) || result.ErrorDetails || "Erro desconhecido no processamento do OCR.";
        throw new Error(`A API ocr.space falhou: ${errorDetails}`);
      }

      const parsedResults = result.ParsedResults;
      if (!parsedResults || !Array.isArray(parsedResults) || parsedResults.length === 0) {
        if (result.ErrorMessage) {
          throw new Error(`Falha no OCR: ${result.ErrorMessage}`);
        }
        throw new Error("A API ocr.space não conseguiu extrair nenhum texto desse documento.");
      }

      // Concatenate parsed texts from all pages (for multi-page pdfs, etc)
      const extractedText = parsedResults.map((r: any) => r.ParsedText).join("\n");
      if (!extractedText || extractedText.trim().length === 0) {
        throw new Error("O texto extraído pela API ocr.space está inteiramente vazio. Verifique a legibilidade ou formato do arquivo.");
      }

      return extractedText;
    } catch (err: any) {
      if (attempts >= maxOcrAttempts) {
        throw err;
      }
      const waitTime = attempts * 3000 + Math.floor(Math.random() * 2000);
      console.warn(`[ocr.space] Erro na requisição: ${err.message}. Retentando em ${waitTime}ms... (Tentativa ${attempts}/${maxOcrAttempts})`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  throw new Error("Falha ao obter resposta estável do OCR Space após múltiplas tentativas de retry.");
}

// Worker method to process a single item
async function runWorker(itemToProcess: ServerQueueItem) {
  activeWorkers++;
  itemToProcess.status = 'processing';
  itemToProcess.progress = 15;
  itemToProcess.retryMessage = undefined;

  try {
    const base64Data = fileContentsMap.get(itemToProcess.id);
    if (!base64Data) {
      throw new Error("Conteúdo do arquivo não disponível na memória do servidor.");
    }

    itemToProcess.progress = 30;

    // Tenta primeiro a extração direta de texto (PDF Digital) para qualquer modo, para economizar cota e evitar 429
    let cleanText = "";
    let directRegexData: Record<string, any> | null = null;
    let isDigitalPdf = false;

    if (itemToProcess.fileName.toLowerCase().endsWith(".pdf")) {
      try {
        console.log(`[QueueWorker] Pré-verificação: tentando decodificar texto digital direto para o arquivo: ${itemToProcess.fileName}`);
        cleanText = (await extractPDFText(base64Data)) || "";
        cleanText = cleanText.trim();
        
        if (cleanText.length > 50) {
          // Verify if this is a complete digital invoice by running local regex first
          const testData = extractFieldsWithRegex(cleanText, itemToProcess.fields);
          const hasCriticalData = testData && testData['numero_instalacao'] && testData['consumo_kwh'];
          
          if (hasCriticalData) {
            isDigitalPdf = true;
            console.log(`[QueueWorker] Texto digital completo e válido obtido localmente (${cleanText.length} caracteres).`);
          } else {
            console.log(`[QueueWorker] Texto digital incompleto obtido (provável PDF escaneado com folha de protocolo digital). Tratando como PDF escaneado.`);
          }
        }
      } catch (err: any) {
        console.warn(`[QueueWorker] Erro ao tentar extrair texto digital direto para ${itemToProcess.fileName}: ${err.message}`);
      }
    }

    if (extractionMode === 'direct' || (extractionMode === 'ocr-space-only' && isDigitalPdf) || (extractionMode === 'google-vision-only' && isDigitalPdf)) {
      if (cleanText.length > 25) {
        console.log(`[QueueWorker] Texto digital encontrado. Aplicando heurísticas regex locais...`);
        directRegexData = extractFieldsWithRegex(cleanText, itemToProcess.fields);
      }

      if (directRegexData) {
        console.log(`[QueueWorker] Sucesso! Usando Extração Digital Direta instantânea (Cota 0) para o arquivo: ${itemToProcess.fileName}`);
        itemToProcess.extractedData = directRegexData;
        itemToProcess.rawSummary = "Extraído offline por decodificador digital direto e mapeamento Regex local (Custo Zero total, sem usar IA ou OCR Space/Vision).";
        itemToProcess.status = 'completed';
        itemToProcess.progress = 100;
        itemToProcess.processedAt = new Date().toISOString();
        // @ts-ignore
        itemToProcess.extractionMethod = extractionMode;
        return;
      } else {
        if (extractionMode === 'direct') {
          throw new Error("Este documento é uma imagem, PDF escaneado ou não possui texto passível de regex local. Como você selecionou o modo 'Apenas Texto Digital (Sem IA)', altere para o perfil Híbrido para ler via inteligência artificial.");
        }
        // Se for ocr-space-only mas falhou em extrair regex ou algo, deixaremos cair na API OCR Space
      }
    }

    // Build schema based on target fields
    const propertiesSchema: Record<string, any> = {};
    const requiredList: string[] = [];

    itemToProcess.fields.forEach((f) => {
      let desc = f.description || `O valor correspondente ao campo de ${f.label}`;
      const fieldName = f.name.toLowerCase();
      
      // Enrich descriptions dynamically to guarantee pristine extraction accuracy
      if (fieldName === 'numero_instalacao') {
        desc += " (Refere-se ao 'Número da Instalação', 'Unidade Consumidora', 'Código Único', 'Código de Cliente', 'Código', 'UC' ou 'Contrato' da distribuidora (Enel, CPFL, Light, Neoenergia, Elektro, Energisa, Cemig). Busque por campos com esses rótulos e retorne exatamente este número identificador. NÃO confunda com CNPJ ou com o número de nota fiscal.)";
      } else if (fieldName === 'mes_referencia') {
        desc += " (Ex: 05/2026, 11/2025 ou NOV/25, no formato brasileiro padrão MM/AAAA. Refere-se à competência ou período faturado. Extraia exatamente o mês e ano correspondente de faturamento.)";
      } else if (fieldName === 'data_vencimento') {
        desc += " (Refere-se ao vencimento da conta, prazo final, ou 'Vencimento'. Deve ser retornado estritamente no formato DD/MM/AAAA. NÃO retorne a data de emissão ou data de apresentação por engano!)";
      } else if (fieldName === 'valor_total') {
        desc += " (O valor monetário total real a pagar desta fatura em Reais. Busque por termos como 'Valor Total', 'Total a Pagar', 'Valor Líquido' ou 'Total do Documento'. Exclua faturamentos parciais de bandeiras ou tarifas unitárias individuais menores como 0.52 etc.)";
      } else if (fieldName === 'consumo_kwh') {
        desc += " (A quantidade física real faturada de energia ativa consumida em kWh, ex: '325', '1450', etc. O consumo de kWh é tipicamente um valor inteiro. IMPORTANTE: NÃO extraia tarifas unitárias (ex: 0.85) e NUNCA extraia valores financeiros tributados ou cobranças monetárias que possuam centavos ou decimais dízimas como '937.22', '537.78', '364.02' etc! O valor correto é o volume de kWh consumidos (ex: 960).)";
      } else if (fieldName === 'concessionaria') {
        desc += " (Identifique o nome da empresa distribuidora de energia que emite a fatura, ex: Enel, CPFL, Elektro, Energisa, Light, Neoenergia, Cemig, Copel, RGE, etc.)";
      }

      propertiesSchema[f.name] = {
        type: Type.STRING, // Use STRING to preserve OCR symbols and flexible format structures
        description: desc
      };
      if (f.required) {
        requiredList.push(f.name);
      }
    });

    // Add general summary field as metadata
    propertiesSchema['_document_summary'] = {
      type: Type.STRING,
      description: 'Um resumo direto e conciso em português (1 a 2 sentenças) sobre o assunto e propósito principal do documento.'
    };
    requiredList.push('_document_summary');

    itemToProcess.progress = 45;

    // Initialize client and request Gemini
    const gemini = getGeminiClient();

    // Remove potential base64 prefix and extract dynamic mime-type (PDF or Images)
    let mimeType = "application/pdf"; // default fallback
    let cleanBase64 = base64Data;

    const base64PartsMatch = base64Data.match(/^data:([^;]+);base64,(.*)$/);
    if (base64PartsMatch) {
      mimeType = base64PartsMatch[1];
      cleanBase64 = base64PartsMatch[2];
    } else {
      // Fallback manual cleaning if format matches prefix-less style
      cleanBase64 = base64Data.replace(/^data:application\/pdf;base64,/, "")
                              .replace(/^data:image\/png;base64,/, "")
                              .replace(/^data:image\/jpeg;base64,/, "")
                              .replace(/^data:image\/jpg;base64,/, "")
                              .replace(/^data:image\/webp;base64,/, "");
      
      const ext = itemToProcess.fileName.split('.').pop()?.toLowerCase();
      if (ext === 'png') mimeType = 'image/png';
      else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
      else if (ext === 'webp') mimeType = 'image/webp';
    }

    const promptText = `Você é um assistente especialista em leitura de documentos, OCR e extração estruturada de dados.
Sua tarefa é analisar o documento (PDF ou imagem) e preencher os dados solicitados exatamente conforme definido no esquema de resposta em JSON.

Instruções importantes:
1. Caso um campo não esteja explicitamente presente no documento, coloque um valor vazio ("") ou nulo.
2. Formate datas no padrão brasileiro DD/MM/YYYY (exemplo: 15/05/2026) caso faça sentido.
3. Não invente ou alucine informações. Transcreva estritamente as informações presentes de maneira fidedigna.
4. ATENÇÃO CRÍTICA: Desconsidere COMPLETAMENTE qualquer página de capa ou "PROTOCOLO DE ACOMPANHAMENTO DE NF" (como o cabeçalho de transporte da MM Delivery/MM Transportes que costuma ser a última página do PDF). NÃO extraia de forma alguma valores de consumo, vencimento, UC ou valor dessa página de protocolo de entrega/acompanhamento. Colete as informações exclusivamente das páginas oficiais da fatura de energia da concessionária (Enel, CPFL, Energisa, etc.), onde os dados reais de consumo (kWh), faturamentos e datas de leitura estão impressos oficialmente pelo emissor do boleto.`;

    itemToProcess.progress = 55;

    let response;
    let methodUsed: 'direct' | 'ai' | 'ocr-space' | 'ocr-space-only' | 'google-vision' | 'google-vision-only' = 'ai';
    let ocrText = "";
    let ocrFailed = false;

    // Se estiver em modo OCR Space (com ou sem IA), tenta obter o texto via API ocr.space (apenas se não for texto digital offline)
    if ((extractionMode === 'ocr-space' || extractionMode === 'ocr-space-only') && !isDigitalPdf) {
      try {
        methodUsed = extractionMode;
        itemToProcess.retryMessage = `Chamando ocr.space (Engine: ${ocrEngine}, Idioma: ${ocrLanguage})...`;
        ocrText = await performOcrSpace(base64Data, ocrApiKey, ocrEngine, ocrLanguage);
      } catch (ocrErr: any) {
        console.warn(`[QueueWorker] Falha na API ocr.space para ${itemToProcess.fileName}: ${ocrErr.message}`);
        ocrFailed = true;
        
        if (extractionMode === 'ocr-space-only') {
          throw new Error(`Falha no leitor de texto externo (OCR Space): ${ocrErr.message}. Como o seu perfil selecionado é de custo zero livre de IA ('Somente OCR Space'), a IA do Gemini foi desativada e bloqueada para poupar créditos.`);
        }

        // Mudar tipo e registrar para a fila o aviso de escalonamento silencioso
        itemToProcess.retryMessage = `⚠️ Limite do OCR Space atingido ou arquivo > 1MB (${ocrErr.message.split('.')[0]}). Escalonando automaticamente para Gemini Vision...`;
        console.log(`[QueueWorker] Escalonamento ativo: Direcionando lote ${itemToProcess.fileName} para processamento multimodal Gemini.`);
      }
    }

    // Se estiver em modo Google Vision (com ou sem IA), tenta obter o texto via Google Vision API (apenas se não for texto digital offline)
    if ((extractionMode === 'google-vision' || extractionMode === 'google-vision-only') && !isDigitalPdf) {
      try {
        methodUsed = extractionMode;
        itemToProcess.retryMessage = `Chamando Google Vision API...`;
        ocrText = await performGoogleVisionOcr(base64Data, itemToProcess.fileName, googleVisionApiKey);
      } catch (visionErr: any) {
        console.warn(`[QueueWorker] Falha na Google Vision API para ${itemToProcess.fileName}: ${visionErr.message}`);
        ocrFailed = true;
        
        if (extractionMode === 'google-vision-only') {
          throw new Error(`Falha no leitor de texto externo (Google Vision API): ${visionErr.message}. Como o seu perfil selecionado é 'Somente Google Vision (Sem IA)', a IA do Gemini foi desativada e bloqueada.`);
        }

        // Mudar tipo e registrar para a fila o aviso de escalonamento silencioso
        itemToProcess.retryMessage = `⚠️ Falha no Google Vision (${visionErr.message.split('.')[0]}). Escalonando automaticamente para Gemini Vision...`;
        console.log(`[QueueWorker] Escalonamento ativo: Direcionando lote ${itemToProcess.fileName} para processamento multimodal Gemini.`);
      }
    }

    // Se obtivemos o texto via OCR Space ou Google Vision com sucesso, processamos dependendo da estratégia escolhida
    if (ocrText && !ocrFailed) {
      if (extractionMode === 'ocr-space-only' || extractionMode === 'google-vision-only') {
        itemToProcess.progress = 80;
        itemToProcess.retryMessage = "Processando texto com Regex locais...";
        
        const ocrRegexData = extractFieldsWithRegex(ocrText, itemToProcess.fields);
        
        // CUSTO ZERO ESTRETO / VISION DIRECT: Salva o resultado diretamente das expressões regulares sem acionar IA
        itemToProcess.extractedData = ocrRegexData;
        itemToProcess.rawSummary = extractionMode === 'google-vision-only'
          ? "Processamento concluído com Google Cloud Vision API + Regex locais (Sem usar IA do Gemini)."
          : "Processamento concluído com custo zero total (sem requisição para IAs). Extraído via OCR Space + Regex locais.";
        itemToProcess.status = 'completed';
        itemToProcess.progress = 100;
        itemToProcess.processedAt = new Date().toISOString();
        itemToProcess.extractionMethod = extractionMode;
        return;
      } else {
        // Modo 'ocr-space' ou 'google-vision': envia o texto estruturado limpo para processamento do Gemini
        itemToProcess.progress = 75;
        itemToProcess.retryMessage = extractionMode === 'google-vision'
          ? "Texto do Google Vision obtido com sucesso! Solicitando refinamento estruturado ao Gemini..."
          : "Texto OCR obtido com sucesso! Solicitando refinamento estruturado ao Gemini...";
        const promptWithOcrText = `Você é um assistente especialista em leitura de documentos, OCR e extração estruturada de dados.
Sua tarefa é analisar o texto extraído de uma fatura/documento pelo leitor óptico ${extractionMode === 'google-vision' ? 'Google Cloud Vision' : 'ocr.space'} e preencher os dados solicitados exatamente conforme definido no esquema de resposta em JSON.

Texto extraído por OCR ${extractionMode === 'google-vision' ? 'Google Cloud Vision' : 'ocr.space'}:
------------------------------------------
${ocrText}
------------------------------------------

Instruções importantes:
1. Caso um campo não esteja explicitamente presente no documento, coloque um valor vazio ("") ou nulo.
2. Formate datas no padrão brasileiro DD/MM/YYYY (exemplo: 15/05/2026) caso faça sentido.
3. Não invente ou alucine informações. Transcreva estritamente as informações presentes de maneira fidedigna.
4. ATENÇÃO CRÍTICA: Desconsidere COMPLETAMENTE qualquer página de capa ou "PROTOCOLO DE ACOMPANHAMENTO DE NF" (como o cabeçalho de transporte da MM Delivery/MM Transportes que costuma ser a última página do PDF). NÃO extraia de forma alguma valores de consumo, vencimento, UC ou valor de faturamento dessa página de protocolo de entrega/acompanhamento. Colete as informações exclusivamente das páginas oficiais da fatura de energia da concessionária (Enel, CPFL, Energisa, etc.), onde os dados reais de consumo (kWh), faturamentos e datas de leitura estão impressos oficialmente pelo emissor do boleto.`;

        response = await callGeminiWithRetry(gemini, {
          model: 'gemini-3.5-flash',
          contents: [promptWithOcrText],
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: propertiesSchema,
              required: requiredList
            }
          }
        }, maxRetries, (msg) => {
          itemToProcess.retryMessage = msg;
        });
      }
    }

    // Se o processamento OCR falhou ou o modo escolhido for puramente baseado em IA, faz o fallback inteligente para o Gemini
    if (!response) {
      if (extractionMode === 'ocr-space-only' || extractionMode === 'google-vision-only') {
        throw new Error(`Erro no processamento de custo zero via ${extractionMode === 'google-vision-only' ? 'Google Cloud Vision' : 'OCR Space'}. Como você selecionou o modo exclusivo de OCR sem IA do Gemini, o processamento inteligente foi bloqueado.`);
      }


      if ((extractionMode === 'hybrid' || extractionMode === 'ocr-space') && cleanText && cleanText.length > 50) {
        methodUsed = 'ai';
        itemToProcess.retryMessage = "Texto digital extraído! Enviando texto otimizado ao Gemini...";
        
        const promptWithText = `Você é um assistente especialista em leitura de documentos, OCR e extração estruturada de dados.
Sua tarefa é analisar o texto extraído de uma fatura/documento de energia e preencher os dados solicitados exatamente conforme definido no esquema de resposta em JSON.

Texto do documento:
------------------------------------------
${cleanText}
------------------------------------------

Instruções importantes:
1. Caso um campo não esteja explicitamente presente no documento, coloque um valor vazio ("") ou nulo.
2. Formate datas no padrão brasileiro DD/MM/YYYY (exemplo: 15/05/2026) caso faça sentido.
3. Não invente ou alucine informações. Transcreva estritamente as informações presentes de maneira fidedigna.
4. ATENÇÃO CRÍTICA: Desconsidere COMPLETAMENTE qualquer página de capa ou "PROTOCOLO DE ACOMPANHAMENTO DE NF" (como o cabeçalho de transporte da MM Delivery/MM Transportes que costuma ser a última página do PDF). NÃO extraia de forma alguma valores de consumo, vencimento, UC ou valor dessa página de protocolo de entrega/acompanhamento. Colete as informações exclusivamente das páginas oficiais da fatura de energia da concessionária (Enel, CPFL, Energisa, etc.), onde os dados reais de consumo (kWh), faturamentos e datas de leitura estão impressos oficialmente pelo emissor do boleto.`;

        response = await callGeminiWithRetry(gemini, {
          model: 'gemini-3.5-flash',
          contents: [promptWithText],
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: propertiesSchema,
              required: requiredList
            }
          }
        }, maxRetries, (msg) => {
          itemToProcess.retryMessage = msg;
        });
      } else {
        // Envia o arquivo de imagem ou PDF como payload multimodal diretamente pra IA
        methodUsed = 'ai';
        itemToProcess.retryMessage = ocrFailed 
          ? "⚡ Escalonado para IA Multimodal (Gemini Vision)..." 
          : "Enviando arquivo multimodal diretamente ao Gemini...";
          
        response = await callGeminiWithRetry(gemini, {
          model: 'gemini-3.5-flash',
          contents: [
            {
              inlineData: {
                mimeType: mimeType,
                data: cleanBase64
              }
            },
            promptText
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: propertiesSchema,
              required: requiredList
            }
          }
        }, maxRetries, (msg) => {
          itemToProcess.retryMessage = msg;
        });
      }
    }

    itemToProcess.progress = 85;
    itemToProcess.retryMessage = undefined;

    const responseText = response.text;
    if (!responseText) {
      throw new Error("A IA retornou uma resposta vazia ou formato inválido.");
    }

    const resultData = JSON.parse(responseText);

    // Filter and map fields
    const extracted: Record<string, any> = {};
    const summary = resultData['_document_summary'] || "Nenhum resumo gerado.";

    itemToProcess.fields.forEach(field => {
      let value = resultData[field.name];
      // Clean and sanitize numbers / values if user requested format conversion
      if (value !== undefined && value !== null) {
        if (field.type === 'number' || field.type === 'currency') {
          // Clean possible characters like currency symbols, spaces, formatting dots
          const rawStr = String(value).trim();
          // Keep digits, comma or dot
          extracted[field.name] = rawStr;
        } else if (field.type === 'date') {
          extracted[field.name] = standardizeDate(String(value));
        } else {
          extracted[field.name] = String(value).trim();
        }
      } else {
        extracted[field.name] = "";
      }
    });

    itemToProcess.extractedData = extracted;
    itemToProcess.rawSummary = summary;
    itemToProcess.status = 'completed';
    itemToProcess.progress = 100;
    itemToProcess.processedAt = new Date().toISOString();
    // @ts-ignore
    itemToProcess.extractionMethod = methodUsed;

  } catch (error: any) {
    console.error("Erro no processamento do item:", itemToProcess.fileName, error);
    itemToProcess.status = 'failed';
    itemToProcess.progress = 100;
    itemToProcess.retryMessage = undefined;
    
    let errorMsg = error?.message || "Ocorreu um erro desconhecido durante o OCR com Gemini.";
    if (String(errorMsg).includes("429") || String(errorMsg).includes("Quota exceeded") || String(errorMsg).includes("RESOURCE_EXHAUSTED") || String(errorMsg).includes("limit: 20")) {
      errorMsg = "Limite de Quotas do Gemini excedido (HTTP 429). IMPORTANTE: Se você já cadastrou um plano de pagamento básico Pay-As-You-Go, este erro indica que você atingiu o limite de TPM (Tokens por Minuto) ou RPM (Requisições por Minuto) do seu projeto do Google Cloud. Como faturas em PDF e imagens são arquivos muito pesados (~258 mil tokens por página), enviar vários lotes ao mesmo tempo pode estourar este limite temporariamente. DICA 1: No painel de Ajustes de Fila (topo direito), aumente o 'Intervalo entre Faturas' (ex: para 8 a 15 segundos) para calibrar a velocidade. DICA 2: Certifique-se de que a sua chave de API criada no Google AI Studio esteja vinculada a um Projeto do Google Cloud com faturamento (Billing) ativo, e não ao projeto sandbox padrão.";
    }
    itemToProcess.error = errorMsg;
  } finally {
    activeWorkers--;
    itemToProcess.retryMessage = undefined;
    // Release heavy raw base64 data to keep RAM footprint low
    fileContentsMap.delete(itemToProcess.id);

    // Call next in line with slight delay to prevent overlapping requests or quota spikes
    setTimeout(() => {
      processQueue().catch(console.error);
    }, queueDelayMs);
  }
}

// Queue workers manager
async function processQueue() {
  if (isQueuePaused) {
    console.log("[Queue] Processamento pausado temporariamente pelo painel.");
    return;
  }

  while (activeWorkers < maxConcurrency) {
    const itemToProcess = queue.find(item => item.status === 'pending');
    if (!itemToProcess) break;

    // Start processing asynchoronously
    runWorker(itemToProcess).catch(console.error);
  }
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // Generous limits for batch uploads
  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ limit: "100mb", extended: true }));

  // --- API Endpoints ---

  // Upload item to processing queue
  app.post("/api/upload", (req, res) => {
    try {
      const { fileName, fileSize, base64Data, fields } = req.body;

      if (!fileName || !base64Data || !fields || !Array.isArray(fields)) {
        return res.status(400).json({ error: "Parâmetros de upload inválidos. Garanta o nome do arquivo, conteúdo em base64 e esquema de campos." });
      }

      const id = "job_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now();
      
      const newQueueItem: ServerQueueItem = {
        id,
        fileName,
        fileSize,
        status: 'pending',
        progress: 0,
        uploadedAt: new Date().toISOString(),
        extractionMethod: extractionMode as any,
        fields
      };

      // Store Base64 in separate memory map to avoid sending it on list fetches
      queue.push(newQueueItem);
      fileContentsMap.set(id, base64Data);

      // Trigger background processing asynchronously
      processQueue().catch(console.error);

      res.json({
        success: true,
        item: {
          id: newQueueItem.id,
          fileName: newQueueItem.fileName,
          fileSize: newQueueItem.fileSize,
          status: newQueueItem.status,
          progress: newQueueItem.progress,
          uploadedAt: newQueueItem.uploadedAt
        }
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Não foi possível enfileirar o arquivo PDF." });
    }
  });

  // Fetch all queue items (metadata + results, excluding heavy base64 strings)
  app.get("/api/queue", (req, res) => {
    res.json({
      success: true,
      queue: queue.map(item => ({
        id: item.id,
        fileName: item.fileName,
        fileSize: item.fileSize,
        status: item.status,
        progress: item.progress,
        error: item.error,
        retryMessage: item.retryMessage,
        extractedData: item.extractedData,
        rawSummary: item.rawSummary,
        uploadedAt: item.uploadedAt,
        processedAt: item.processedAt,
        extractionMethod: item.extractionMethod
      }))
    });
  });

  // Update a single cell values manually (User Edit Override)
  app.post("/api/queue/update-row", (req, res) => {
    const { id, extractedData } = req.body;
    const item = queue.find(q => q.id === id);
    
    if (!item) {
      return res.status(404).json({ error: "Item do catálogo não encontrado." });
    }

    item.extractedData = {
      ...(item.extractedData || {}),
      ...extractedData
    };

    res.json({ success: true, item });
  });

  // Re-enqueue/retry a failed queue item
  app.post("/api/queue/retry", (req, res) => {
    const { id, base64Data } = req.body; // Client sends back base64 from historical state
    const item = queue.find(q => q.id === id);

    if (!item) {
      return res.status(404).json({ error: "Item para reposição na fila não encontrado." });
    }

    if (!base64Data) {
      return res.status(400).json({ error: "A recuperação do conteúdo base64 é necessária para reprocessar." });
    }

    item.status = 'pending';
    item.progress = 0;
    item.error = undefined;
    item.extractionMethod = extractionMode as any;
    fileContentsMap.set(id, base64Data);

    // Trigger processing
    processQueue().catch(console.error);

    res.json({ success: true, item });
  });

  // Delete a catalog item / row
  app.post("/api/queue/delete-row", (req, res) => {
    const { id } = req.body;
    const index = queue.findIndex(q => q.id === id);
    if (index === -1) {
      return res.status(404).json({ error: "Item não encontrado." });
    }

    queue.splice(index, 1);
    fileContentsMap.delete(id);

    res.json({ success: true });
  });

  // Clear all items / reset state
  app.post("/api/queue/clear", (req, res) => {
    queue.length = 0;
    fileContentsMap.clear();
    activeWorkers = 0;
    res.json({ success: true });
  });

  // Get/Set processing delay configurations
  app.get("/api/queue/settings", (req, res) => {
    const clientProvidedPassword = req.headers['x-admin-password'] || req.query.password || "";
    const isUnlocked = !adminPassword || clientProvidedPassword === adminPassword;

    res.json({
      delayMs: queueDelayMs,
      maxConcurrency,
      extractionMode,
      isQueuePaused,
      maxRetries,
      ocrEngine,
      ocrLanguage,
      hasAdminPassword: !!adminPassword,
      isUnlocked,
      // Only return original keys if unlocked, otherwise mask them
      ocrApiKey: isUnlocked ? ocrApiKey : (ocrApiKey ? "••••••••••••••••" : ""),
      googleVisionApiKey: isUnlocked ? googleVisionApiKey : (googleVisionApiKey ? "••••••••••••••••" : ""),
      geminiApiKey: isUnlocked ? geminiApiKey : (geminiApiKey ? "••••••••••••••••" : ""),
      isUsingDefaultGemini: !geminiApiKey && !!process.env.GEMINI_API_KEY
    });
  });

  app.post("/api/queue/settings", (req, res) => {
    const clientProvidedPassword = req.headers['x-admin-password'] || req.body.adminPasswordConfirm || "";
    const isUnlocked = !adminPassword || clientProvidedPassword === adminPassword;

    if (!isUnlocked) {
      return res.status(403).json({ error: "Área de configurações protegida por senha administrativa." });
    }

    const {
      delayMs,
      maxConcurrency: targetConcurrency,
      extractionMode: targetMode,
      isQueuePaused: targetPause,
      maxRetries: targetRetries,
      ocrApiKey: targetApiKey,
      ocrEngine: targetEngine,
      ocrLanguage: targetLanguage,
      googleVisionApiKey: targetVisionApiKey,
      geminiApiKey: targetGeminiApiKey,
      adminPassword: newAdminPassword
    } = req.body;

    if (typeof delayMs === 'number' && delayMs >= 0) {
      queueDelayMs = delayMs;
    }
    if (typeof targetConcurrency === 'number' && targetConcurrency >= 1) {
      maxConcurrency = targetConcurrency;
    }
    if (targetMode === 'hybrid' || targetMode === 'direct' || targetMode === 'ai' || targetMode === 'ocr-space' || targetMode === 'ocr-space-only' || targetMode === 'google-vision' || targetMode === 'google-vision-only') {
      extractionMode = targetMode;
    }
    if (typeof targetPause === 'boolean') {
      isQueuePaused = targetPause;
    }
    if (typeof targetRetries === 'number' && targetRetries >= 0) {
      maxRetries = targetRetries;
    }
    if (typeof targetApiKey === 'string' && targetApiKey !== "••••••••••••••••") {
      ocrApiKey = targetApiKey;
    }
    if (typeof targetEngine === 'string') {
      ocrEngine = targetEngine;
    }
    if (typeof targetLanguage === 'string') {
      ocrLanguage = targetLanguage;
    }
    if (typeof targetVisionApiKey === 'string' && targetVisionApiKey !== "••••••••••••••••") {
      googleVisionApiKey = targetVisionApiKey;
    }
    if (typeof targetGeminiApiKey === 'string' && targetGeminiApiKey !== "••••••••••••••••") {
      geminiApiKey = targetGeminiApiKey;
    }
    if (typeof newAdminPassword === 'string') {
      adminPassword = newAdminPassword;
    }
    
    // Trigger queue in case concurrency/pause state has been changed
    processQueue().catch(console.error);

    res.json({
      success: true,
      delayMs: queueDelayMs,
      maxConcurrency,
      extractionMode,
      isQueuePaused,
      maxRetries,
      ocrEngine,
      ocrLanguage,
      hasAdminPassword: !!adminPassword,
      isUnlocked: true,
      ocrApiKey,
      googleVisionApiKey,
      geminiApiKey: isUnlocked ? geminiApiKey : (geminiApiKey ? "••••••••••••••••" : ""),
      isUsingDefaultGemini: !geminiApiKey && !!process.env.GEMINI_API_KEY
    });
  });

  // Vite development integration or static serving
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[OCR Server] running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
