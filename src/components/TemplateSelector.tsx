import React from 'react';
import { ExtractionField } from '../types';
import { Settings, Zap, Shield } from 'lucide-react';

interface TemplateSelectorProps {
  fields: ExtractionField[];
  onFieldsChange?: (fields: ExtractionField[]) => void;
}

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({ fields }) => {
  return (
    <div className="bg-sand-200 border-2 border-dark-900 rounded-none shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b-2 border-dark-900 flex items-center justify-between bg-dark-900 text-sand-100">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-brand-orange" />
          <h2 className="text-xs font-bold uppercase tracking-widest font-mono">Modelo de Extração OCR</h2>
        </div>
        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-none bg-brand-orange text-dark-900 border border-dark-900 flex items-center gap-1">
          <Zap className="w-3 h-3" />
          CONTA DE LUZ
        </span>
      </div>

      <div className="p-4 space-y-4 font-mono">
        {/* Dynamic Warning Alert */}
        <div className="bg-white border-2 border-dark-900 p-3.5 flex gap-2.5 items-start text-dark-900">
          <Shield className="w-5 h-5 text-brand-orange shrink-0 mt-0.5" />
          <div className="text-[10px] leading-relaxed">
            <span className="font-bold text-brand-orange">CONTA DE ENERGIA & LUZ (EXCLUSIVO)</span>
            <p className="mt-1 text-dark-900/85">
              O sistema foi otimizado exclusivamente para faturas de energia elétrica brasileiras (<strong>ENEL, CPFL, Energisa, etc.</strong>). Outros formatos secundários foram ocultados para garantir custo zero de quotas via OCR + Regex e calibrar a precisão no faturamento.
            </p>
          </div>
        </div>

        {/* Selected Fields Table */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <label className="block text-[10px] font-bold text-dark-900 uppercase tracking-widest font-mono">
              [✓] Campos de Ativos Mapeados ({fields.length})
            </label>
          </div>

          <div className="overflow-x-auto border border-dark-900 bg-white max-h-[220px] overflow-y-auto">
            <table className="w-full text-[10px] text-left">
              <thead className="bg-[#141414] text-[#E4E3E0] uppercase border-b border-dark-900 sticky top-0">
                <tr>
                  <th className="px-2.5 py-1.5 font-bold">Variável</th>
                  <th className="px-2.5 py-1.5 font-bold">Título</th>
                  <th className="px-2.5 py-1.5 font-bold">Tipo</th>
                  <th className="px-2.5 py-1.5 text-center font-bold">Obrigatório</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-900/20 text-dark-900 bg-sand-100/30">
                {fields.map((field) => (
                  <tr key={field.id} className="hover:bg-brand-orange/5">
                    <td className="px-2.5 py-1.5 font-semibold text-dark-900 max-w-[120px] truncate">{field.name}</td>
                    <td className="px-2.5 py-1.5 font-bold text-dark-900 max-w-[120px] truncate">{field.label}</td>
                    <td className="px-2.5 py-1.5">
                      <span className={`px-1 py-0.2 text-[8.5px] font-bold border border-dark-900 ${
                        field.type === 'currency' ? 'bg-emerald-100 text-emerald-950' :
                        field.type === 'date' ? 'bg-amber-100 text-amber-950' :
                        field.type === 'number' ? 'bg-blue-100 text-blue-950' :
                        'bg-white text-dark-900'
                      }`}>
                        {field.type === 'currency' ? 'BRL (R$)' :
                         field.type === 'date' ? 'DATA' :
                         field.type === 'number' ? 'NUM (kWh)' : 'TXT'}
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5 text-center font-bold">
                      {field.required ? 'SIM' : 'NÃO'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
