import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Ensure Gemini Client is initialized with process.env.GEMINI_API_KEY
// Use lazy instantiation or wrap it carefully so we handle missing keys gracefully.
let ai: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY não foi configurada nos Secrets da aplicação. Por favor, adicione-a no menu Settings > Secrets para utilizar a extração inteligente.");
    }
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
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
          sleepMs = (15 + attempt * 10) * 1000; // 1ª vez: 25s, 2ª vez: 35s, etc.
          onRetry?.(`Prevenção de Cota Gratuita (429). Aguardando ${sleepMs / 1000}s para resetar janela de cota do Gemini (Tentativa ${attempt}/${maxRetries})...`);
        } else if (isTransient) {
          // Para desvios de alta demanda (503), uma pequena pausa e alternância de modelo resolvem rápido
          sleepMs = (7 + attempt * 5) * 1000;
          
          if (currentModel === 'gemini-3.5-flash') {
            currentModel = 'gemini-2.5-flash';
          } else if (currentModel === 'gemini-2.1-flash' || currentModel === 'gemini-2.5-flash') {
            currentModel = 'gemini-1.5-flash';
          } else {
            currentModel = 'gemini-1.5-flash';
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
        
        // Exponentially increase backend scale delay for next try
        delay = delay * 2 + Math.floor(Math.random() * 2000);
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
  fields: ExtractionField[]; // Store fields to extract
}

// Global In-Memory queue
const queue: ServerQueueItem[] = [];
const fileContentsMap = new Map<string, string>(); // id -> base64
let activeWorkers = 0;
let maxConcurrency = 1; // Default to 1 (economic/free plan auto-scaled)
let queueDelayMs = 4500; // Default cooldown delay 4.5s between files to safely stay standard below 15 RPM (free tier limits)

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

    // Build schema based on target fields
    const propertiesSchema: Record<string, any> = {};
    const requiredList: string[] = [];

    itemToProcess.fields.forEach((f) => {
      propertiesSchema[f.name] = {
        type: Type.STRING, // Use STRING to preserve OCR symbols and flexible format structures
        description: f.description || `O valor correspondente ao campo de ${f.label}`
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

    // Remove potential base64 prefix
    const cleanBase64 = base64Data.replace(/^data:application\/pdf;base64,/, "");

    const promptText = `Você é um assistente especialista em leitura de documentos, OCR e extração estruturada de dados.
Sua tarefa é analisar o documento PDF e preencher os dados solicitados exatamente conforme definido no esquema de resposta em JSON.

Instruções importantes:
1. Caso um campo não esteja explicitamente presente no documento, coloque um valor vazio ("") ou nulo.
2. Formate datas no padrão internacional YYYY-MM-DD caso faça sentido.
3. Não invente ou alucine informações. Transcreva estritamente as informações presentes de maneira fidedigna.`;

    itemToProcess.progress = 60;

    const response = await callGeminiWithRetry(gemini, {
      model: 'gemini-3.5-flash',
      contents: [
        {
          inlineData: {
            mimeType: 'application/pdf',
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
    }, 6, (msg) => {
      // Atualizar mensagem de reporte que vai pro poll do front-end
      itemToProcess.retryMessage = msg;
    });

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

  } catch (error: any) {
    console.error("Erro no processamento do item:", itemToProcess.fileName, error);
    itemToProcess.status = 'failed';
    itemToProcess.progress = 100;
    itemToProcess.retryMessage = undefined;
    
    let errorMsg = error?.message || "Ocorreu um erro desconhecido durante o OCR com Gemini.";
    if (String(errorMsg).includes("429") || String(errorMsg).includes("Quota exceeded") || String(errorMsg).includes("RESOURCE_EXHAUSTED") || String(errorMsg).includes("limit: 20")) {
      errorMsg = "Limite de Quotas do Gemini excedido (HTTP 429). Motivo: A sua chave de API ultrapassou os limites do canais do plano gratuito (e.g. 15 requisições por minuto ou cota diária de 20 requests). DICA: Cadastre um plano de pagamento básico sem custo fixo (Pay-As-You-Go) no Google AI Studio para obter canais de alta velocidade e limites ultra elevados (geralmente gratuitas até limites massivos ou custando menos de R$ 0,05 centavos por lote).";
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
        processedAt: item.processedAt
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
    res.json({ delayMs: queueDelayMs, maxConcurrency });
  });

  app.post("/api/queue/settings", (req, res) => {
    const { delayMs, maxConcurrency: targetConcurrency } = req.body;
    if (typeof delayMs === 'number' && delayMs >= 0) {
      queueDelayMs = delayMs;
    }
    if (typeof targetConcurrency === 'number' && targetConcurrency >= 1) {
      maxConcurrency = targetConcurrency;
    }
    
    // Trigger queue in case concurrency has been raised
    processQueue().catch(console.error);

    res.json({ success: true, delayMs: queueDelayMs, maxConcurrency });
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
