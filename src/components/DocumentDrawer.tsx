import React, { useState } from 'react';
import { QueueItem, ExtractionField } from '../types';
import { X, Copy, Check, FileText, Info, Calendar, Database, Eye } from 'lucide-react';

interface DocumentDrawerProps {
  item: QueueItem | null;
  fields: ExtractionField[];
  onClose: () => void;
}

export const DocumentDrawer: React.FC<DocumentDrawerProps> = ({
  item,
  fields,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  if (!item) return null;

  const copyJsonToClipboard = () => {
    const rawJson = JSON.stringify({
      id: item.id,
      documentName: item.fileName,
      processedDate: item.processedAt,
      summary: item.rawSummary,
      data: item.extractedData
    }, null, 2);
    
    navigator.clipboard.writeText(rawJson)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(console.error);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" aria-labelledby="slide-over-title" role="dialog" aria-modal="true">
      <div className="absolute inset-0 overflow-hidden">
        {/* Backdrop overlay */}
        <div 
          onClick={onClose}
          className="absolute inset-0 bg-[#141414]/50 backdrop-blur-xs transition-opacity"
        />

        <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
          <div className="pointer-events-auto w-screen max-w-md transform bg-sand-100 transition-transform duration-300 ease-in-out border-l-4 border-dark-900 shadow-xl">
            {/* Drawer Container */}
            <div className="flex h-full flex-col overflow-y-auto bg-sand-100 text-dark-900 font-mono text-xs">
              {/* Header */}
              <div className="bg-dark-900 text-sand-100 px-4 py-3 border-b-2 border-dark-900 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="p-1.5 bg-brand-orange text-dark-900 border border-dark-900 shrink-0">
                    <FileText className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-xs font-bold uppercase tracking-wider truncate max-w-[200px]" title={item.fileName}>
                      {item.fileName}
                    </h2>
                    <p className="text-[9px] text-sand-200/60 uppercase">Dossiê Técnico de Metadados</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-1 bg-brand-orange text-dark-900 border border-dark-900 hover:bg-[#141414] hover:text-sand-100 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-4 space-y-5">
                {/* Meta details */}
                <div className="grid grid-cols-2 gap-2 bg-[#C4C3BF] p-3 border-2 border-dark-900 font-mono text-[10px]">
                  <div className="space-y-0.5">
                    <span className="text-dark-900/60 block font-bold uppercase">PESO DO ARQUIVO</span>
                    <span className="text-dark-900 font-bold">{(item.fileSize / 1024).toFixed(1)} KB</span>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-dark-900/60 block font-bold uppercase">TRANSMISSÃO</span>
                    <span className="text-dark-900 font-bold">{new Date(item.uploadedAt).toLocaleString('pt-BR')}</span>
                  </div>
                </div>

                {/* AI Summary Card */}
                {item.rawSummary && (
                  <div className="bg-[#F27D26]/10 p-3 border-2 border-dark-900 space-y-1 font-mono">
                    <div className="flex items-center gap-1.5 text-dark-900 font-bold text-[10px] uppercase tracking-wider">
                      <Info className="w-4 h-4 text-brand-orange shrink-0" />
                      SÍNTESE INTELIGENTE REUNIDA (AI)
                    </div>
                    <p className="text-[11px] text-dark-900 leading-relaxed italic">
                      "{item.rawSummary}"
                    </p>
                  </div>
                )}

                {/* Extracted Fields Metadata */}
                <div className="space-y-2">
                  <h3 className="text-[10px] font-bold text-dark-900 uppercase tracking-widest flex items-center gap-1.5 font-mono">
                    <Database className="w-3.5 h-3.5 text-brand-orange" />
                    [ PROPRIEDADES CATALOGADAS ]
                  </h3>
                  <div className="border-2 border-dark-900 bg-white overflow-hidden divide-y divide-dark-900/10 font-mono text-[11px]">
                    {fields.map(field => {
                      const val = item.extractedData?.[field.name];
                      return (
                        <div key={field.id} className="p-2.5 hover:bg-brand-orange/[0.03] flex items-start gap-4 justify-between transition-colors">
                          <div className="space-y-0.5 min-w-0 grow">
                            <span className="font-bold text-dark-900 block truncate">{field.label}</span>
                            <span className="text-[9px] text-dark-900/50 block font-bold italic">{field.name}</span>
                          </div>
                          <span className="font-mono text-[11px] font-bold text-dark-900 text-right shrink-0 bg-sand-100 px-2 py-1 border border-dark-900 max-w-[180px] break-all">
                            {field.type === 'currency' && val && !String(val).includes('R$') ? `R$ ${val}` : val || '-'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* JSON Snippet Console */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between font-mono">
                    <h3 className="text-[10px] font-bold text-dark-900 uppercase tracking-widest flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5 text-[#141414]" />
                      LOG RAW (PAYLOAD_JSON)
                    </h3>
                    <button
                      onClick={copyJsonToClipboard}
                      className="text-[9px] font-bold text-dark-900 bg-white hover:bg-brand-orange border border-dark-900 px-2 py-0.5 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-700" /> COPIADO
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" /> COPIAR JSON
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="bg-dark-900 text-sand-100 p-3 border-2 border-dark-900 text-[9px] font-mono overflow-x-auto leading-relaxed max-h-[160px] shadow-xs">
                    {JSON.stringify({
                      file: item.fileName,
                      catalogId: item.id,
                      extracted: item.extractedData,
                      summary: item.rawSummary
                    }, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
