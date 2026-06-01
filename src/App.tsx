import { useState, useEffect } from 'react';
import { ExtractionField, QueueItem, ProcessingStats } from './types';
import { TemplateSelector } from './components/TemplateSelector';
import { QueueViewer } from './components/QueueViewer';
import { CatalogTable } from './components/CatalogTable';
import { DocumentDrawer } from './components/DocumentDrawer';
import { Sparkles, FileText, Cpu, AlertCircle, Info, HelpCircle } from 'lucide-react';

const INITIAL_FIELDS: ExtractionField[] = [
  { id: '1', name: 'numero_nota', label: 'Número da Nota', type: 'string', description: 'O número de série ou identificador único da nota fiscal ou fatura', required: true },
  { id: '2', name: 'data_emissao', label: 'Data de Emissão', type: 'date', description: 'A data em que a nota ou fatura foi emitida, preferencialmente formatada em YYYY-MM-DD', required: true },
  { id: '3', name: 'valor_total', label: 'Valor Total', type: 'currency', description: 'O valor financeiro total líquido ou bruto do documento em reais (ex: 2450.00)', required: true },
  { id: '4', name: 'emissor_nome', label: 'Razão Social/Emissor', type: 'string', description: 'O nome da empresa ou pessoa emitente do documento', required: false },
  { id: '5', name: 'emissor_cnpj', label: 'CNPJ do Emissor', type: 'string', description: 'O CNPJ da empresa que emitiu o documento fiscal', required: false }
];

export default function App() {
  const [fields, setFields] = useState<ExtractionField[]>(INITIAL_FIELDS);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [viewingDetailsItem, setViewingDetailsItem] = useState<QueueItem | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [delayMs, setDelayMs] = useState<number>(2000);
  const [maxConcurrency, setMaxConcurrency] = useState<number>(1);
  const [isServerOffline, setIsServerOffline] = useState(false);

  // Poll server for queue updates
  useEffect(() => {
    fetchQueue();
    fetchSettings();
    // Set up short-polling interval
    const interval = setInterval(() => {
      fetchQueue();
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/queue/settings');
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        setIsServerOffline(true);
        return;
      }
      const data = await res.json();
      if (data) {
        if (typeof data.delayMs === 'number') {
          setDelayMs(data.delayMs);
        }
        if (typeof data.maxConcurrency === 'number') {
          setMaxConcurrency(data.maxConcurrency);
        }
        setIsServerOffline(false);
      }
    } catch (e) {
      console.error("Erro ao carregar configurações de delay:", e);
      setIsServerOffline(true);
    }
  };

  const handleUpdateSettings = async (updates: { delayMs?: number; maxConcurrency?: number }) => {
    try {
      const res = await fetch('/api/queue/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        throw new Error("O servidor de backend não respondeu com JSON na atualização do delay.");
      }
      const data = await res.json();
      if (data.success) {
        setDelayMs(data.delayMs);
        setMaxConcurrency(data.maxConcurrency);
        setIsServerOffline(false);
      }
    } catch (e) {
      console.error("Erro ao atualizar delay:", e);
    }
  };

  const fetchQueue = async () => {
    try {
      const res = await fetch('/api/queue');
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        setIsServerOffline(true);
        return;
      }
      const data = await res.json();
      if (data.success) {
        setQueue(data.queue);
        setIsServerOffline(false);
      }
    } catch (e) {
      console.error("Não foi possível conectar-se ao servidor de OCR:", e);
      setIsServerOffline(true);
    }
  };

  // Convert HTML5 files to Base64
  const convertToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  const handleFilesDropped = async (files: FileList) => {
    setUploadError(null);
    setIsUploading(true);

    // Keep active files for sequential backend enqueuing
    const pdfFiles = Array.from(files).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));

    if (pdfFiles.length === 0) {
      setUploadError("Por favor, selecione apenas arquivos com formato .pdf válido.");
      setIsUploading(false);
      return;
    }

    try {
      for (const file of pdfFiles) {
        const base64 = await convertToBase64(file);
        
        // Post base64 payload & fields schema list of fields to server queue
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            fileSize: file.size,
            base64Data: base64,
            fields: fields // Send contemporary defined targeting schema!
          })
        });

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          throw new Error("O servidor respondeu com um formato inválido (HTML). Seus arquivos não puderam ser enfileirados. Verifique se o seu backend Express está online ou se foi hospedado em um ambiente estático como o Cloudflare Pages padrão.");
        }

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || `Falha ao enfileirar o documento ${file.name}`);
        }
      }

      // Re-trigger update immediately
      await fetchQueue();
    } catch (err: any) {
      setUploadError(err?.message || "Ocorreu um erro no enfileiramento de seus arquivos.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleUpdateRow = async (id: string, updatedData: Record<string, any>) => {
    try {
      const res = await fetch('/api/queue/update-row', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, extractedData: updatedData })
      });

      if (res.ok) {
        // Sync local representation
        setQueue(prev => prev.map(item => {
          if (item.id === id) {
            return {
              ...item,
              extractedData: {
                ...(item.extractedData || {}),
                ...updatedData
              }
            };
          }
          return item;
        }));

        // Sync detailed view too if active
        if (viewingDetailsItem && viewingDetailsItem.id === id) {
          setViewingDetailsItem(prev => prev ? {
            ...prev,
            extractedData: {
              ...(prev.extractedData || {}),
              ...updatedData
            }
          } : null);
        }
      }
    } catch (e) {
      console.error("Erro ao atualizar item do catálogo:", e);
    }
  };

  const handleDeleteRow = async (id: string) => {
    try {
      const res = await fetch('/api/queue/delete-row', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });

      if (res.ok) {
        setQueue(prev => prev.filter(item => item.id !== id));
        if (viewingDetailsItem?.id === id) {
          setViewingDetailsItem(null);
        }
      }
    } catch (e) {
      console.error("Erro ao deletar registro:", e);
    }
  };

  const handleClearQueue = async () => {
    try {
      await fetch('/api/queue/clear', { method: 'POST' });
      setQueue([]);
      setViewingDetailsItem(null);
    } catch (e) {
      console.error("Erro ao limpar a fila:", e);
    }
  };

  // Compute metrics stats inside standard useMemo equivalents
  const stats: ProcessingStats = queue.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.status === 'pending') acc.pending += 1;
      else if (item.status === 'processing') acc.processing += 1;
      else if (item.status === 'completed') acc.completed += 1;
      else if (item.status === 'failed') acc.failed += 1;
      return acc;
    },
    { total: 0, pending: 0, processing: 0, completed: 0, failed: 0 }
  );

  return (
    <div className="min-h-screen bg-sand-100 text-dark-900 font-sans antialiased flex flex-col border-4 md:border-8 border-dark-900">
      {/* Heavy High-Density Top Navigation */}
      <header className="bg-dark-900 text-sand-100 px-4 md:px-6 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 border-b-4 border-dark-900">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-brand-orange flex items-center justify-center font-bold text-dark-900 text-xs border border-dark-900 shadow-xs shrink-0 select-none">
            OCR
          </div>
          <div>
            <h1 className="text-sm md:text-base font-bold tracking-tighter uppercase italic font-mono flex items-center gap-2">
              Leitor OCR | Batch Process Engine
            </h1>
            <p className="text-[9px] text-sand-200/60 font-mono tracking-widest uppercase">Multi-PDF to Excel Catalog Loader</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex flex-col items-end opacity-80 text-[10px] font-mono leading-tight">
            <span className="uppercase text-brand-orange font-bold">STATUS: AUTOMATED WORKER ONLINE</span>
            <span>AGENTS ACTIVE: 100% (CONCURRENT SCALED QUEUE)</span>
          </div>
          <span className="text-[10px] uppercase font-mono font-bold px-2 py-1 bg-brand-orange text-dark-900 border border-dark-900 flex items-center gap-1.5 animate-pulse">
            <Sparkles className="w-3 h-3 text-dark-900" />
            Gemini Pro Core
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="grow w-full max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        {/* Static Hosting / Server Offline Alert Warning */}
        {isServerOffline && (
          <div className="bg-amber-100 border-2 border-amber-950 text-amber-950 font-mono text-xs p-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] rounded-none space-y-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-800 shrink-0" />
              <p className="font-bold uppercase tracking-wider text-sm">[ DETECTADO: SERVIDOR BACKEND OFFLINE / HOSPEDAGEM PORTÁTIL OU ESTÁTICA ]</p>
            </div>
            <p className="leading-relaxed text-[11px] font-semibold text-dark-900/90">
              O front-end não pôde conectar-se com o servidor Node.js backend estruturado na aplicação (as rotas do diretório <code className="bg-amber-200 px-1">/api/*</code> retornaram um formato não-JSON ou erro de rede).
              Isso costuma ocorrer caso você tenha feito o deploy desta aplicação em um ambiente de <strong>hospedagem puramente estática (como o Cloudflare Pages padrão, Netlify ou GitHub Pages)</strong> sem acoplar o servidor Express de back-end.
            </p>
            <div className="bg-white/60 p-3 border border-amber-950/20 rounded-none space-y-1.5 text-[10px]">
              <span className="font-bold text-dark-900 block font-sans">Como solucionar este cenário e evitar o erro:</span>
              <ul className="list-disc list-inside space-y-1">
                <li><strong>Opção Recomendada (Cloud Run do Google Cloud):</strong> O AI Studio permite publicar a aplicação diretamente no Cloud Run. O Cloud Run hospeda o front-end e o back-end integrados em um container Docker unificado rodando em alta performance e escalabilidade.</li>
                <li><strong>Deploy Full-Stack Alternativo:</strong> Se desejar utilizar plataformas externas ao AI Studio, faça o deploy em plataformas que oferecem suporte nativo a servidores Node/Express tradicionais, tais como <em>Railway.app</em>, <em>Render.com</em>, <em>Fly.io</em>, ou <em>Heroku</em>.</li>
                <li><strong>Adaptação Cloudflare (Worker de API):</strong> Caso prefira manter no Cloudflare, as rotas que dependem do arquivo <code className="bg-amber-200 px-1">server.ts</code> devem ser migradas para o <strong>Cloudflare Workers (usando Cloudflare Pages Functions)</strong> de modo que rodem como funções Serverless.</li>
              </ul>
            </div>
          </div>
        )}

        {/* Notice Board Instruction */}
        <div className="bg-[#D1D0CC] border-2 border-dark-900 p-4 shadow-sm flex items-start gap-3">
          <div className="p-1.5 bg-dark-900 text-brand-orange border border-dark-900 shrink-0">
            <HelpCircle className="w-4 h-4" />
          </div>
          <div className="space-y-1 font-mono">
            <h2 className="text-xs font-bold uppercase tracking-wider text-dark-900">Manual Técnico de Operação (OCR)</h2>
            <p className="text-[11px] text-dark-900/80 leading-relaxed">
              1. Selecione ou personalize o <strong>Esquema de Dados</strong> ao lado para instruir quais chaves de metadados extrair do PDF.<br />
              2. Jogue múltiplos PDFs simultâneos na <strong>Fila de Lote</strong>. O processamento automático escalona os envios para evitar gargalos.<br />
              3. O catálogo final sincronitário permite ajustar erros à mão com clique duplo. Clique em <strong>Excel</strong> para baixar o inventário pronto.
            </p>
          </div>
        </div>

        {/* Upload feedback errors */}
        {uploadError && (
          <div className="p-3 bg-red-100 border-2 border-red-900 text-red-900 font-mono text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold">ORDEM FALHOU / ERROR REPORTED:</p>
              <p className="text-[10px]">{uploadError}</p>
            </div>
          </div>
        )}

        {/* Global Loader for massive uploads */}
        {isUploading && (
          <div className="p-3.5 bg-indigo-100 border-2 border-dark-900 font-mono text-xs flex items-center gap-3 text-indigo-950 font-bold animate-pulse">
            <Cpu className="w-4 h-4 text-indigo-900 animate-spin" />
            <span>MÁQUINA EM OPERAÇÃO: Convertendo arquivos para pacotes binários Base64 e enviando ao lote ativo...</span>
          </div>
        )}

        {/* Dynamic Multi-Column Workspace Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Controls Panel */}
          <div className="lg:col-span-5 space-y-5">
            <TemplateSelector
              fields={fields}
              onFieldsChange={setFields}
            />
          </div>

          {/* Monitor and Queue Progress Board */}
          <div className="lg:col-span-7 space-y-5">
            <QueueViewer
              queue={queue}
              stats={stats}
              onFilesDropped={handleFilesDropped}
              onClearQueue={handleClearQueue}
              delayMs={delayMs}
              maxConcurrency={maxConcurrency}
              onUpdateSettings={handleUpdateSettings}
            />
          </div>
        </div>

        {/* Catalog Grid View */}
        <CatalogTable
          queue={queue}
          fields={fields}
          onUpdateRow={handleUpdateRow}
          onDeleteRow={handleDeleteRow}
          onViewDetails={setViewingDetailsItem}
        />
      </main>

      {/* Overlay Details Info Panel */}
      <DocumentDrawer
        item={viewingDetailsItem}
        fields={fields}
        onClose={() => setViewingDetailsItem(null)}
      />

      {/* Industrial Machine Terminal Footer */}
      <footer className="bg-dark-900 text-sand-100 border-t-4 border-dark-900 py-3.5 px-4 md:px-6 font-mono text-[10px]">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider">
            <span className="w-2.5 h-2.5 bg-brand-orange animate-ping rounded-full inline-block"></span>
            <span>CATALOG-OCR SERVER STABLE</span>
          </div>
          <div className="flex gap-4 text-sand-200/50">
            <span>PING: 8ms</span>
            <span>CPU CORE USAGE: 14%</span>
            <span>HEAP: 218MB / 1024MB</span>
          </div>
          <p className="opacity-60">© 2026 Inteligência de Extração em Lote.</p>
        </div>
      </footer>
    </div>
  );
}
