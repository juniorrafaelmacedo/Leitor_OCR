import React, { useRef, useState } from 'react';
import { QueueItem, ProcessingStats } from '../types';
import { Upload, File, CheckCircle2, XCircle, Loader2, AlertCircle, RefreshCw, BarChart2, Clock, Shield } from 'lucide-react';

interface QueueViewerProps {
  queue: QueueItem[];
  stats: ProcessingStats;
  onFilesDropped: (files: FileList) => void;
  onClearQueue: () => void;
  delayMs?: number;
  maxConcurrency?: number;
  extractionMode?: 'hybrid' | 'direct' | 'ai' | 'ocr-space';
  isQueuePaused?: boolean;
  maxRetries?: number;
  ocrApiKey?: string;
  ocrEngine?: string;
  ocrLanguage?: string;
  onUpdateSettings?: (updates: {
    delayMs?: number;
    maxConcurrency?: number;
    extractionMode?: 'hybrid' | 'direct' | 'ai' | 'ocr-space';
    isQueuePaused?: boolean;
    maxRetries?: number;
    ocrApiKey?: string;
    ocrEngine?: string;
    ocrLanguage?: string;
  }) => void;
  onRetryAllFailed?: () => void;
  onRetryRow?: (id: string) => void;
}

export const QueueViewer: React.FC<QueueViewerProps> = ({
  queue,
  stats,
  onFilesDropped,
  onClearQueue,
  delayMs = 4500,
  maxConcurrency = 1,
  extractionMode = 'hybrid',
  isQueuePaused = false,
  maxRetries = 3,
  ocrApiKey = 'K88221884388957',
  ocrEngine = '2',
  ocrLanguage = 'por',
  onUpdateSettings,
  onRetryAllFailed,
  onRetryRow,
}) => {
  const [isDragActive, setIsDragActive] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeAndPendingCount = stats.pending + stats.processing;
  
  // Calcular estimativa com base no perfil de velocidade selecionado
  const getEstimatedTimeText = () => {
    if (activeAndPendingCount === 0) return null;
    
    let secondsPerFile = 7.5; // Default grátis: 4.5s delay + ~3s resposta por fatura
    if (delayMs === 1000 && maxConcurrency === 3) {
      secondsPerFile = 1.3;
    } else if (delayMs === 0 && maxConcurrency === 6) {
      secondsPerFile = 0.5;
    } else {
      secondsPerFile = (delayMs / 1000) + (3.0 / maxConcurrency);
    }
    
    const totalSeconds = Math.ceil(activeAndPendingCount * secondsPerFile);
    
    if (totalSeconds < 60) {
      return `${totalSeconds} segundos`;
    }
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins} min e ${secs}s`;
  };

  const estimatedTimeText = getEstimatedTimeText();

  // Encontrar se algum item está ativamente em retentativa e reportando status para o backend
  const activeRetryItem = queue.find(item => item.status === 'processing' && item.retryMessage);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      // Filter for PDF documents or images
      const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
      const validFiles = Array.from(e.dataTransfer.files).filter((f: any) => 
        allowedTypes.includes(f.type) || 
        /\.(pdf|png|jpe?g|webp)$/i.test(f.name)
      );

      if (validFiles.length === 0) {
        alert("Por favor, solte apenas faturas no formato PDF ou Imagens (PNG, JPG, JPEG, WebP).");
        return;
      }
      
      onFilesDropped(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFilesDropped(e.target.files);
    }
  };

  const handleSelectClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-4">
      {/* Upload Zone */}
      <div
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={handleSelectClick}
        className={`border-2 border-dark-900 rounded-none p-6 text-center transition-all cursor-pointer flex flex-col items-center justify-center min-h-[160px] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] relative overflow-hidden ${
          isDragActive
            ? 'bg-brand-orange text-dark-900'
            : 'bg-white hover:bg-sand-100 text-dark-900'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,application/pdf,image/png,image/jpeg,image/jpg,image/webp"
          onChange={handleFileChange}
          className="hidden"
        />
        <div className="p-2 mb-2 bg-dark-900 border border-dark-900 text-brand-orange shrink-0">
          <Upload className="w-5 h-5" />
        </div>
        <h3 className="text-xs font-bold font-mono uppercase tracking-widest">[ ARRASTE SEUS ARQUIVOS PDF OU IMAGENS AQUI ]</h3>
        <p className="text-[10px] font-mono text-dark-900/60 mt-1 max-w-sm">
          Suporta múltiplos lotes simultâneos (PDFs, PNG, JPG, JPEG, WebP) para pipeline inteligente.
        </p>
        <button
          type="button"
          className="mt-3 px-3 py-1 text-[10px] font-bold font-mono tracking-wider text-sand-100 bg-dark-900 hover:bg-brand-orange hover:text-dark-900 border border-dark-900 cursor-pointer pointer-events-none uppercase"
        >
          Pesquisar Arquivos no Disco
        </button>
      </div>

      {/* 1. MODO DE RECONHECIMENTO (Tela Única, Super Simplificada) */}
      <div className="bg-sand-200 border-2 border-dark-900 rounded-none p-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] text-dark-900 font-mono">
        <div className="flex items-center gap-1.5 mb-2">
          <Shield className="w-4 h-4 text-brand-orange" />
          <h4 className="text-xs font-bold uppercase tracking-wider">[ MODO DE RECONHECIMENTO ]</h4>
        </div>
        <p className="text-[10px] text-dark-900/75 leading-relaxed mb-3.5">
          Selecione o motor de leitura ideal. Evite dúvidas escolhendo uma de nossas 3 estratégias de leitura recomendadas:
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {[
            {
              id: 'hybrid' as const,
              label: "🧠 1. Híbrido Inteligente",
              badge: "Gemini IA + Local",
              desc: "O padrão inteligente. Decodifica arquivos digitais de graça e usa a IA do Gemini apenas em mídias escaneadas ou fotos.",
              isActive: extractionMode === 'hybrid'
            },
            {
              id: 'direct' as const,
              label: "⚡ 2. Leitura Digital Direta",
              badge: "Cota Zero (Sem IA)",
              desc: "100% grátis e imediato. Lê textos digitais originais da fatura e preenche os campos usando expressões locais.",
              isActive: extractionMode === 'direct'
            },
            {
              id: 'ocr-space-only' as const,
              label: "🚀 3. Somente OCR Space",
              badge: "Sem IA / OCR Seguro",
              desc: "Processa fotos/scans usando unicamente a API ocr.space e mapeia dados via regex local. Livre de custos ou limites Gemini.",
              isActive: extractionMode === 'ocr-space-only'
            }
          ].map((modeOpt) => {
            return (
              <button
                key={modeOpt.id}
                type="button"
                onClick={() => onUpdateSettings?.({ extractionMode: modeOpt.id })}
                className={`p-3 border-2 text-left flex flex-col justify-between transition-all cursor-pointer ${
                  modeOpt.isActive 
                    ? 'border-dark-900 bg-brand-orange text-dark-900 font-bold shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]' 
                    : 'border-dark-900/30 bg-white hover:bg-sand-150 text-dark-900/80 hover:border-dark-900'
                }`}
              >
                <div>
                  <span className="text-[10px] uppercase font-black block leading-tight">{modeOpt.label}</span>
                  <span className="inline-block px-1.5 py-0.2 text-[7.5px] font-black uppercase tracking-wider bg-dark-900 text-sand-100 rounded-none mt-1">
                    {modeOpt.badge}
                  </span>
                </div>
                <span className="text-[8.5px] opacity-85 block mt-2.5 leading-relaxed font-sans font-normal border-t border-dark-900/10 pt-2">{modeOpt.desc}</span>
              </button>
            );
          })}
        </div>

        {/* Action link for Advanced Settings */}
        <div className="mt-3.5 flex justify-end">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-[9px] font-black uppercase tracking-wider text-dark-900 hover:text-brand-orange hover:border-dark-900 bg-white px-2 py-1 border-2 border-dark-900 shadow-[2px_2px_0px_0px_rgba(20,20,20,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all cursor-pointer flex items-center gap-1.5"
          >
            <span>{showAdvanced ? "▲ Ocultar Ajustes Avançados" : "⚙️ Mostrar Opções Avançadas e Chaves"}</span>
          </button>
        </div>

        {/* OCR Space parameters integrated directly when an OCR mode is chosen (so they are simple and context-aware!) */}
        {(extractionMode === 'ocr-space' || extractionMode === 'ocr-space-only') && (
          <div className="mt-3.5 p-3 bg-white border-2 border-dark-900 shadow-[2px_2px_0px_0px_rgba(20,20,20,1)] text-[#141414] font-mono">
            <div className="text-[10px] font-bold uppercase text-brand-orange border-b border-dark-900/10 pb-1.5 mb-2.5 flex items-center gap-1.5">
              <span>⚙️ PARÂMETROS OBRIGATÓRIOS DO OCR.SPACE</span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* API Key */}
              <div>
                <label className="block text-[8.5px] font-black uppercase mb-1">Chave de API ocr.space:</label>
                <input
                  type="text"
                  value={ocrApiKey}
                  onChange={(e) => onUpdateSettings?.({ ocrApiKey: e.target.value })}
                  placeholder="Insira sua Chave de API"
                  className="w-full bg-sand-100 border-2 border-dark-900 text-[#141414] px-2 py-1 text-[10px] font-mono font-bold focus:bg-white focus:outline-none"
                />
                <span className="text-[7.5px] text-dark-900/60 mt-0.5 block font-bold">Padrão PRO: K88221884388957</span>
              </div>

              {/* OCR Engine Selection */}
              <div>
                <label className="block text-[8.5px] font-black uppercase mb-1">Motor OCR (Engine):</label>
                <select
                  value={ocrEngine}
                  onChange={(e) => onUpdateSettings?.({ ocrEngine: e.target.value })}
                  className="w-full bg-sand-100 border-2 border-dark-900 text-[#141414] px-2 py-1 text-[10px] font-mono font-bold focus:bg-white focus:outline-none cursor-pointer"
                >
                  <option value="1">Engine 1 (Padrão Geral)</option>
                  <option value="2">Engine 2 (Otimizado p/ Números e Faturas)</option>
                  <option value="3">Engine 3 (Velocidade e Letras Pequenas)</option>
                </select>
                <span className="text-[7.5px] text-dark-900/60 mt-0.5 block">Recomendado: Engine 2</span>
              </div>

              {/* Language Selection */}
              <div>
                <label className="block text-[8.5px] font-black uppercase mb-1">Idioma do Documento:</label>
                <select
                  value={ocrLanguage}
                  onChange={(e) => onUpdateSettings?.({ ocrLanguage: e.target.value })}
                  className="w-full bg-sand-100 border-2 border-dark-900 text-[#141414] px-2 py-1 text-[10px] font-mono font-bold focus:bg-white focus:outline-none cursor-pointer"
                >
                  <option value="por">Português (por)</option>
                  <option value="eng">Inglês (eng)</option>
                  <option value="spa">Espanhol (spa)</option>
                </select>
                <span className="text-[7.5px] text-dark-900/60 mt-0.5 block">Identifica acentos locais</span>
              </div>
            </div>

            <div className="mt-2.5 pt-2 border-t border-dark-900/10 flex items-start gap-1 text-[8.5px] text-dark-900/70 leading-normal">
              <span>💡</span>
              <span>
                {extractionMode === 'ocr-space-only' ? (
                  <><strong>Fluxo sem IA:</strong> O documento será lido via OCR Space e os campos da tabela serão preenchidos usando apenas expressões regulares locais, garantindo consumo de cota zero da API Gemini!</>
                ) : (
                  <><strong>Fluxo OCR + IA:</strong> A fatura será processada pelo leitor OCR Space primeiro, e o texto gerado será estruturado e refinado pela inteligência artificial do Gemini!</>
                )}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 2. AJUSTES AVANÇADOS (Ocultados por Padrão para não Poluir a interface) */}
      {showAdvanced && (
        <div className="space-y-4 pt-1 transition-all">
          
          {/* Rate Limits / Processing Speed Controller */}
          <div className="bg-sand-200 border-2 border-dark-900 rounded-none p-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] text-dark-900 font-mono">
            <div className="flex items-center gap-1.5 mb-2">
              <Clock className="w-4 h-4 text-brand-orange" />
              <h4 className="text-xs font-bold uppercase tracking-wider">[ PERFIL DE VELOCIDADE DO LOTE ]</h4>
            </div>
            <p className="text-[10px] text-dark-900/75 leading-relaxed mb-3">
              Selecione o perfil que melhor se alinha com sua chave de API do Gemini para evitar erros de quota ou lentidão.
            </p>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[
                { 
                  label: "1. 100% Grátis (Auto-Escalonado)", 
                  delayMs: 4500, 
                  concurrency: 1, 
                  badge: "Grátis (0 R$)",
                  desc: "1 arq. por vez, delay 4.5s. Ideal para lotes grandes de graça; escala e aguarda taticamente as cotas.",
                  isActive: delayMs === 4500 && maxConcurrency === 1
                },
                { 
                  label: "2. Uso Normal (Recomendado)", 
                  delayMs: 1000, 
                  concurrency: 3, 
                  badge: "Pago (Centavos)",
                  desc: "3 arqs. simultâneos. Ideal p/ 300 faturas (~R$0,50 total!).",
                  isActive: delayMs === 1000 && maxConcurrency === 3
                },
                { 
                  label: "3. Ultra Seguro / Rápido", 
                  delayMs: 0, 
                  concurrency: 6, 
                  badge: "Prod. Corporativa",
                  desc: "6 arqs. simultâneos, sem atraso. 350 faturas em 1 min.",
                  isActive: delayMs === 0 && maxConcurrency === 6
                }
              ].map((mode, idx) => {
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onUpdateSettings?.({ delayMs: mode.delayMs, maxConcurrency: mode.concurrency })}
                    className={`p-2.5 border-2 text-left flex flex-col justify-between transition-all cursor-pointer ${
                      mode.isActive 
                        ? 'border-dark-900 bg-brand-orange text-dark-900 font-bold shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]' 
                        : 'border-dark-900/30 bg-white hover:bg-sand-150 text-dark-900/80 hover:border-dark-900'
                    }`}
                  >
                    <div>
                      <span className="text-[10px] uppercase font-bold block leading-tight">{mode.label}</span>
                      <span className="inline-block px-1 py-0.2 text-[7.5px] font-black uppercase tracking-wider bg-dark-900 text-sand-100 rounded-none mt-1">
                        {mode.badge}
                      </span>
                    </div>
                    <span className="text-[8.5px] opacity-85 block mt-2 leading-relaxed font-sans font-normal border-t border-dark-900/10 pt-1.5">{mode.desc}</span>
                  </button>
                );
              })}
            </div>
            
            {/* Max Retries configuration */}
            <div className="mt-3.5 pt-3 border-t border-dark-900/10 flex flex-col sm:flex-row sm:items-center justify-between text-[11px] gap-2">
              <span className="font-bold uppercase tracking-wider text-dark-900/70">Re-tentativas por documento (Quota Error Backup):</span>
              <select
                value={maxRetries}
                onChange={(e) => onUpdateSettings?.({ maxRetries: parseInt(e.target.value, 10) })}
                className="bg-white border-2 border-dark-900 text-dark-900 px-2 py-0.5 text-[10px] font-mono font-bold rounded-none focus:outline-none cursor-pointer"
              >
                <option value={0}>0 (Falhar rápido)</option>
                <option value={1}>1 tentativa de segurança</option>
                <option value={2}>2 tentativas</option>
                <option value={3}>3 tentativas (Padrão Recomendado)</option>
                <option value={4}>4 tentativas</option>
                <option value={5}>5 de segurança máxima</option>
              </select>
            </div>
          </div>

          {/* Outros Perfis de Processamento Alternativos */}
          <div className="bg-sand-200 border-2 border-dark-900 rounded-none p-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] text-dark-900 font-mono">
            <div className="flex items-center gap-1.5 mb-2">
              <Shield className="w-4 h-4 text-brand-orange" />
              <h4 className="text-xs font-bold uppercase tracking-wider">[ PERFIS DE PROCESSAMENTO DE NICHO ]</h4>
            </div>
            <p className="text-[10px] text-dark-900/75 leading-relaxed mb-3">
              Perfis adicionais suportados para faturas complexas de nicho:
            </p>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {[
                { 
                  id: 'ai' as const,
                  label: "4. Forçar Totalmente Gemini IA", 
                  badge: "Sempre Consome Chave de API",
                  desc: "Desativa o pré-leitor digital local e força a leitura via Visão Computacional do Gemini para todos os arquivos. Uso tático em fotos rotacionadas.",
                  isActive: extractionMode === 'ai'
                },
                { 
                  id: 'ocr-space' as const,
                  label: "5. Híbrido OCR Space + Refinamento Gemini", 
                  badge: "Leitor OCR Híbrido",
                  desc: "Combina o melhor dos dois mundos: realiza OCR via ocr.space e passa o texto estruturado para refino gramatical do Gemini.",
                  isActive: extractionMode === 'ocr-space'
                }
              ].map((modeOpt) => {
                return (
                  <button
                    key={modeOpt.id}
                    type="button"
                    onClick={() => onUpdateSettings?.({ extractionMode: modeOpt.id })}
                    className={`p-2.5 border-2 text-left flex flex-col justify-between transition-all cursor-pointer ${
                      modeOpt.isActive 
                        ? 'border-dark-900 bg-brand-orange text-dark-900 font-bold shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]' 
                        : 'border-dark-900/30 bg-white hover:bg-sand-150 text-dark-900/80 hover:border-dark-900'
                    }`}
                  >
                    <div>
                      <span className="text-[10px] uppercase font-bold block leading-tight">{modeOpt.label}</span>
                      <span className="inline-block px-1 py-0.2 text-[7.5px] font-black uppercase tracking-wider bg-dark-900 text-sand-100 rounded-none mt-1">
                        {modeOpt.badge}
                      </span>
                    </div>
                    <span className="text-[8.5px] opacity-85 block mt-2 leading-relaxed font-sans font-normal border-t border-dark-900/10 pt-1.5">{modeOpt.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Batch Pause and Resume Controller */}
      {queue.length > 0 && (
        <div className="bg-sand-200 border-2 border-dark-900 rounded-none p-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] text-dark-900 font-mono">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-brand-orange animate-spin" style={{ animationDuration: isQueuePaused ? '0s' : '4s' }} />
              <h4 className="text-xs font-bold uppercase tracking-wider">[ PAINEL DE CONTROLE DE FLUXO DO LOTE ]</h4>
            </div>
            <div>
              <span className={`inline-block px-1.5 py-0.5 text-[8.5px] font-black uppercase border border-dark-900 ${
                isQueuePaused ? 'bg-amber-100 text-amber-950 animate-pulse' : 'bg-emerald-100 text-[#141414]'
              }`}>
                {isQueuePaused ? 'FILA PAUSADA' : 'ESTADO ATIVO'}
              </span>
            </div>
          </div>
          <p className="text-[10px] text-dark-900/75 leading-relaxed mt-2 mb-3">
            Para garantir o sucesso de 300 faturas no plano grátis (15 requisições por minuto), você pode pausar o processador temporariamente para drenar quotas de IA ou clicar para reexecutar apenas os itens que falharam.
          </p>
          
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onUpdateSettings?.({ isQueuePaused: !isQueuePaused })}
              className={`px-3 py-1.5 border-2 text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-[2px_2px_0px_0px_rgba(20,20,20,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all ${
                isQueuePaused 
                  ? 'bg-emerald-250 hover:bg-emerald-300 text-emerald-950 border-dark-900' 
                  : 'bg-amber-100 hover:bg-amber-250 text-amber-950 border-dark-900'
              }`}
            >
              <span>
                {isQueuePaused ? '▶️ Retomar Fila de Lote' : '⏸️ Pausar Fila de Lote'}
              </span>
            </button>

            {stats.failed > 0 && onRetryAllFailed && (
              <button
                type="button"
                onClick={onRetryAllFailed}
                className="px-3 py-1.5 border-2 border-dark-900 bg-red-100 hover:bg-red-200 text-red-950 text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-[2px_2px_0px_0px_rgba(20,20,20,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
              >
                🔄 Re-enfileirar ({stats.failed}) Erros
              </button>
            )}
          </div>
        </div>
      )}

      {/* Metrics Row */}
      {queue.length > 0 && (
        <div className="space-y-3">
          {/* Alerta de Cooldown / Retentativa do Gemini no plano Gratuito */}
          {activeRetryItem && (
            <div className="bg-amber-100 border-2 border-amber-950 p-3 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] font-mono text-dark-900 rounded-none flex items-start gap-2.5 animate-pulse">
              <RefreshCw className="w-5 h-5 text-amber-800 shrink-0 mt-0.5 animate-spin" />
              <div>
                <span className="text-[10px] font-black uppercase text-amber-950 block">[ EVITADOR DE ERROS DA COTA GRATUITA ATIVO ]</span>
                <span className="text-[11px] leading-relaxed block tracking-tight mt-0.5">{activeRetryItem.retryMessage}</span>
              </div>
            </div>
          )}

          {/* Banner de tempo restante estimado de lote grande */}
          {activeAndPendingCount > 0 && (
            <div className="bg-[#141414] border-2 border-dark-900 text-sand-100 p-3.5 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] font-mono rounded-none">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <div className="p-1 bg-brand-orange text-dark-900 border border-dark-900 shrink-0">
                    <Clock className="w-4 h-4 text-dark-900 animate-pulse" />
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-sand-200/60 uppercase block">CRONOGRAMA DO LOTE ATIVO</span>
                    <span className="text-[11px] font-black text-brand-orange uppercase flex items-center gap-1.5 mt-0.5">
                      tempo restante estimado: ~{estimatedTimeText}
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="inline-block px-1.5 py-0.5 text-[8.5px] font-black uppercase tracking-wider bg-brand-orange text-dark-900 rounded-none border border-dark-900">
                    {activeAndPendingCount} restantes
                  </span>
                </div>
              </div>
              <p className="text-[9.5px] text-sand-200/60 leading-relaxed mt-2.5 border-t border-sand-100/15 pt-2 font-sans font-normal">
                Com o perfil <strong>100% Gratuito (Auto-Escalonado)</strong>, o sistema processa sequencialmente de forma cadenciada para manter sua cota do Gemini gratuita intacta. Se surgir cota esgotada temporária, o sistema pausa por breves segundos e <strong>tenta de novo sozinho</strong> sem falhar nem quebrar o lote de faturas!
              </p>
            </div>
          )}

          <div className="bg-[#C4C3BF] border-2 border-dark-900 rounded-none p-3.5 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <div className="flex items-center gap-2 mb-2.5 text-[9px] font-black text-dark-900 uppercase tracking-widest font-mono">
              <BarChart2 className="w-3.5 h-3.5 text-dark-900" />
              VIGILÂNCIA DE RENDIMENTO DA FILA (STATS)
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 font-mono">
              <div className="bg-white p-2 border border-dark-900 text-dark-900">
                <span className="block text-[8px] uppercase font-bold text-dark-900/55">Registros</span>
                <span className="text-sm font-bold">{stats.total}</span>
              </div>
              <div className="bg-amber-100 p-2 border border-dark-900 text-dark-900">
                <span className="block text-[8px] uppercase font-bold text-dark-900/55">Pendente</span>
                <span className="text-sm font-bold">{stats.pending}</span>
              </div>
              <div className="bg-blue-100 p-2 border border-dark-900 text-dark-900 flex flex-col justify-between">
                <span className="block text-[8px] uppercase font-bold text-dark-900/55">Ativa</span>
                <span className="text-sm font-bold flex items-center gap-1.5">
                  {stats.processing}
                  {stats.processing > 0 && <RefreshCw className="w-3.5 h-3.5 animate-spin text-dark-900 shrink-0" />}
                </span>
              </div>
              <div className="bg-emerald-100 p-2 border border-dark-900 text-dark-900">
                <span className="block text-[8px] uppercase font-bold text-dark-900/55">Sucesso</span>
                <span className="text-sm font-bold">{stats.completed}</span>
              </div>
              <div className="bg-red-100 p-2 border border-dark-900 text-red-950">
                <span className="block text-[8px] uppercase font-bold text-red-900/55">Erros</span>
                <span className="text-sm font-bold">{stats.failed}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Queue items list */}
      {queue.length > 0 && (
        <div className="bg-sand-200 border-2 border-dark-900 rounded-none overflow-hidden shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
          <div className="px-3 py-2 border-b-2 border-dark-900 flex items-center justify-between text-[11px] font-bold font-mono text-sand-100 bg-dark-900 uppercase tracking-widest">
            <span>Fila Sequencial ({queue.length} PDFs)</span>
            <button
              onClick={onClearQueue}
              className="text-[9px] text-[#F27D26] hover:bg-brand-orange hover:text-dark-900 border border-[#F27D26] px-1.5 py-0.5 font-bold uppercase transition-colors cursor-pointer"
            >
              Excluir Lote
            </button>
          </div>

          <div className="max-h-[220px] overflow-y-auto divide-y divide-dark-900/10 font-mono bg-white">
            {queue.map((item) => (
              <div key={item.id} className="p-3 hover:bg-brand-orange/[0.04] transition-colors flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="p-1 bg-dark-900 border border-dark-900 text-brand-orange shrink-0">
                      <File className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-[11px] font-bold text-dark-900 truncate" title={item.fileName}>
                        {item.fileName}
                      </h4>
                      <p className="text-[9px] text-dark-900/50">
                        {(item.fileSize / 1024).toFixed(1)} KB • {new Date(item.uploadedAt).toLocaleTimeString('pt-BR')}
                      </p>
                    </div>
                  </div>

                  {/* Status Badges */}
                  <div className="flex items-center shrink-0">
                    {item.status === 'pending' && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 border border-dark-900 bg-sand-200 text-dark-900 uppercase">
                        PAUSE_QUEUED
                      </span>
                    )}
                    {item.status === 'processing' && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 border border-dark-900 bg-blue-100 text-dark-900 flex items-center gap-1 uppercase">
                        <RefreshCw className="w-2.5 h-2.5 animate-spin text-dark-900" />
                        RUNNING_OCR
                      </span>
                    )}
                    {item.status === 'completed' && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 border border-dark-900 bg-emerald-100 text-[#141414] flex items-center gap-1 uppercase">
                        <CheckCircle2 className="w-3 h-3 text-dark-900" />
                        COMPLETED
                      </span>
                    )}
                    {item.status === 'failed' && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 border border-dark-900 bg-red-100 text-red-900 flex items-center gap-1 uppercase">
                        <XCircle className="w-3 h-3 text-dark-900" />
                        FAILED
                      </span>
                    )}
                  </div>
                </div>

                {/* Processing bar (for active or awaiting elements) */}
                {(item.status === 'processing' || item.status === 'pending') && (
                  <div className="space-y-1 w-full flex flex-col">
                    <div className="w-full flex items-center gap-2">
                      <div className="grow bg-sand-100 border border-dark-900 h-3 overflow-hidden rounded-none relative">
                        <div
                          className={`h-full border-r border-dark-900 transition-all duration-300 ${
                            item.status === 'processing' ? 'bg-brand-orange animate-pulse' : 'bg-sand-300'
                          }`}
                          style={{ width: `${item.progress || 5}%` }}
                        />
                      </div>
                      <span className="text-[9px] font-mono font-bold text-dark-900 shrink-0">
                        {item.progress || 0}%
                      </span>
                    </div>
                    {item.status === 'processing' && item.retryMessage && (
                      <div className="bg-amber-100/70 border border-amber-950/20 text-[8.5px] px-2 py-1 flex items-center gap-1.5 text-[#5c3e09] font-bold animate-pulse leading-tight">
                        <RefreshCw className="w-2.5 h-2.5 animate-spin shrink-0 text-[#a16207]" />
                        <span>{item.retryMessage}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Displaying inline error when failed */}
                {item.status === 'failed' && item.error && (
                  <div className="text-[9px] text-red-900 bg-red-100/60 p-2 border border-red-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 leading-relaxed">
                    <div className="flex items-start gap-1.5 min-w-0">
                      <AlertCircle className="w-3.5 h-3.5 text-red-700 shrink-0 mt-0.5" />
                      <span className="break-words">Falha: {item.error}</span>
                    </div>
                    {onRetryRow && (
                      <button
                        type="button"
                        onClick={() => onRetryRow(item.id)}
                        className="bg-red-850 hover:bg-dark-900 text-white hover:text-brand-orange px-2 py-0.5 font-mono border border-red-950 text-[8.5px] font-bold uppercase shrink-0 transition-colors cursor-pointer"
                      >
                        🔄 Re-tentar
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
