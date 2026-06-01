import React, { useRef, useState } from 'react';
import { QueueItem, ProcessingStats } from '../types';
import { Upload, File, CheckCircle2, XCircle, Loader2, AlertCircle, RefreshCw, BarChart2, Clock, Shield } from 'lucide-react';

interface QueueViewerProps {
  queue: QueueItem[];
  stats: ProcessingStats;
  onFilesDropped: (files: FileList) => void;
  onClearQueue: () => void;
  delayMs?: number;
  onDelayChange?: (val: number) => void;
}

export const QueueViewer: React.FC<QueueViewerProps> = ({
  queue,
  stats,
  onFilesDropped,
  onClearQueue,
  delayMs = 2000,
  onDelayChange,
}) => {
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      // Filter for PDF documents only
      const pdfFiles = Array.from(e.dataTransfer.files).filter((f: any) => f.type === 'application/pdf');
      if (pdfFiles.length === 0) {
        alert("Por favor, solte apenas arquivos em formato PDF.");
        return;
      }
      
      // We package them as a mock FileList object or forward directly
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
          accept=".pdf,application/pdf"
          onChange={handleFileChange}
          className="hidden"
        />
        <div className="p-2 mb-2 bg-dark-900 border border-dark-900 text-brand-orange shrink-0">
          <Upload className="w-5 h-5" />
        </div>
        <h3 className="text-xs font-bold font-mono uppercase tracking-widest">[ ARRASTE SEUS ARQUIVOS PDF AQUI ]</h3>
        <p className="text-[10px] font-mono text-dark-900/60 mt-1 max-w-sm">
          Suporta múltiplos lotes simultâneos para pipeline integrada inteligente.
        </p>
        <button
          type="button"
          className="mt-3 px-3 py-1 text-[10px] font-bold font-mono tracking-wider text-sand-100 bg-dark-900 hover:bg-brand-orange hover:text-dark-900 border border-dark-900 cursor-pointer pointer-events-none uppercase"
        >
          Pesquisar PDFs no Disco
        </button>
      </div>

      {/* Rate Limits / Processing Speed Controller */}
      <div className="bg-sand-200 border-2 border-dark-900 rounded-none p-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] text-dark-900 font-mono">
        <div className="flex items-center gap-1.5 mb-2">
          <Clock className="w-4 h-4 text-brand-orange" />
          <h4 className="text-xs font-bold uppercase tracking-wider">[ CONTROLE DE INTERVALO DO LOTE ]</h4>
        </div>
        <p className="text-[10px] text-dark-900/75 leading-relaxed mb-3">
          Configure um intervalo de espera entre arquivos. Intervalos maiores são ideais para o <strong>plano gratuito</strong> do Gemini (evitam erros de excesso de cota diária ou limite de requisições sem custo algum).
        </p>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            { label: "Normal (2s)", value: 2000, desc: "Uso leve / Eventual" },
            { label: "Econômico (15s)", value: 15000, desc: "Evita picos temporários" },
            { label: "Ultra Seguro (40s)", value: 40000, desc: "Para lotes grátis contínuos" }
          ].map((mode) => {
            const isSelected = delayMs === mode.value;
            return (
              <button
                key={mode.value}
                onClick={() => onDelayChange?.(mode.value)}
                className={`p-2 border-2 text-center flex flex-col justify-between transition-all cursor-pointer ${
                  isSelected 
                    ? 'border-dark-900 bg-brand-orange text-dark-900 font-bold shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]' 
                    : 'border-dark-900/30 bg-white hover:bg-sand-150 text-dark-900/80 hover:border-dark-900'
                }`}
              >
                <span className="text-[10px] uppercase font-bold block">{mode.label}</span>
                <span className="text-[8px] opacity-70 block mt-0.5 leading-none">{mode.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Metrics Row */}
      {queue.length > 0 && (
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
                )}

                {/* Displaying inline error when failed */}
                {item.status === 'failed' && item.error && (
                  <div className="text-[9px] text-red-900 bg-red-100/60 p-2 border border-red-950/30 flex items-start gap-1.5 leading-relaxed">
                    <AlertCircle className="w-3.5 h-3.5 text-red-700 shrink-0 mt-0.5" />
                    <span>Falha: {item.error}</span>
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
