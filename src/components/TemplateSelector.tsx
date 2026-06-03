import React, { useState } from 'react';
import { ExtractionField } from '../types';
import { Settings, Plus, Trash2, FileSpreadsheet, Layers, FileText
, Sparkles, Zap } from 'lucide-react';

interface TemplateSelectorProps {
  fields: ExtractionField[];
  onFieldsChange: (fields: ExtractionField[]) => void;
}

const PRESETS = [
  {
    id: 'invoices',
    name: 'Notas Fiscais / Faturas',
    shortName: 'NOTAS/FATURAS',
    icon: FileSpreadsheet,
    color: 'emerald',
    fields: [
      { id: '1', name: 'numero_nota', label: 'Número da Nota', type: 'string', description: 'O número de série ou identificador único da nota fiscal ou fatura', required: true },
      { id: '2', name: 'data_emissao', label: 'Data de Emissão', type: 'date', description: 'A data em que a nota ou fatura foi emitida, preferencialmente formatada em YYYY-MM-DD', required: true },
      { id: '3', name: 'valor_total', label: 'Valor Total', type: 'currency', description: 'O valor financeiro total líquido ou bruto do documento em reais (ex: 2450.00)', required: true },
      { id: '4', name: 'emissor_nome', label: 'Razão Social/Emissor', type: 'string', description: 'O nome da empresa ou pessoa emitente do documento', required: false },
      { id: '5', name: 'emissor_cnpj', label: 'CNPJ do Emissor', type: 'string', description: 'O CNPJ da empresa que emitiu o documento fiscal', required: false }
    ] as ExtractionField[]
  },
  {
    id: 'receipts',
    name: 'Recibos & Comprovantes',
    shortName: 'RECIBOS',
    icon: FileText,
    color: 'blue',
    fields: [
      { id: '11', name: 'pagador', label: 'Nome do Pagador', type: 'string', description: 'Nome da pessoa física ou jurídica que efetuou o pagamento', required: true },
      { id: '12', name: 'beneficiario', label: 'Nome do Beneficiário', type: 'string', description: 'Nome ou razão social de quem recebeu o pagamento', required: true },
      { id: '13', name: 'data_pagamento', label: 'Data do Pagamento', type: 'date', description: 'Data em que a transação ocorreu (padrão YYYY-MM-DD)', required: true },
      { id: '14', name: 'valor', label: 'Valor Pago', type: 'currency', description: 'O valor numérico pago no recibo', required: true },
      { id: '15', name: 'descricao', label: 'Descrição / Finalidade', type: 'string', description: 'Breve explicação descrita do motivo ou produto associado ao pagamento', required: false }
    ] as ExtractionField[]
  },
  {
    id: 'energy_bills',
    name: 'Conta de Energia / Luz',
    shortName: 'ENERGIA/LUZ',
    icon: Zap,
    color: 'amber',
    fields: [
      { id: '31', name: 'numero_instalacao', label: 'Nº da Instalação', type: 'string', description: 'O código ou número da instalação da unidade consumidora de energia', required: true },
      { id: '32', name: 'mes_referencia', label: 'Mês Referência', type: 'string', description: 'O mês e ano de faturamento da conta, por exemplo, 05/2026', required: true },
      { id: '33', name: 'data_vencimento', label: 'Vencimento', type: 'date', description: 'A data de vencimento final da fatura', required: true },
      { id: '34', name: 'valor_total', label: 'Valor Total', type: 'currency', description: 'O valor monetário total a ser pago da conta de luz em reais', required: true },
      { id: '35', name: 'consumo_kwh', label: 'Consumo (kWh)', type: 'number', description: 'A quantidade gasta de energia ativa consumida em kWh registrado nesta fatura (pode estar descrito como "consumo", "kWh", "consumo ativo", "total consumido" ou "energia ativa")', required: true },
      { id: '36', name: 'concessionaria', label: 'Distribuidora', type: 'string', description: 'Nome da concessionária distribuidora de energia (ex: Enel, Light, Neoenergia, CPFL, Cemig, Copel)', required: false }
    ] as ExtractionField[]
  },
  {
    id: 'contracts',
    name: 'Contratos Comerciais',
    shortName: 'CONTRATOS',
    icon: Layers,
    color: 'indigo',
    fields: [
      { id: '21', name: 'tipo_contrato', label: 'Tipo de Contrato', type: 'string', description: 'Identificação do tipo de contrato (ex: Aluguel, Prestação de Serviços, Parceria)', required: true },
      { id: '22', name: 'contratante', label: 'Contratante / Parte A', type: 'string', description: 'O nome ou razão social da primeira parte envolvida que contrata o serviço', required: true },
      { id: '23', name: 'contratado', label: 'Contratado / Parte B', type: 'string', description: 'O nome ou razão social da parte prestadora de serviço ou vendedora', required: true },
      { id: '24', name: 'data_assinatura', label: 'Data de Assinatura', type: 'date', description: 'Data em que as partes firmaram ou assinaram o contrato', required: false },
      { id: '25', name: 'valor_contrato', label: 'Valor Global', type: 'currency', description: 'Valor financeiro total do acordo comercial no documento', required: false },
      { id: '26', name: 'vigencia', label: 'Vigência / Prazo', type: 'string', description: 'Prazo estipulado para a duração da vigência do contrato', required: false }
    ] as ExtractionField[]
  }
];

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({ fields, onFieldsChange }) => {
  const [activePreset, setActivePreset] = useState<string>('energy_bills');
  const [editingField, setEditingField] = useState<Partial<ExtractionField>>({
    name: '',
    label: '',
    type: 'string',
    description: '',
    required: false
  });
  const [showForm, setShowForm] = useState(false);

  const applyPreset = (presetId: string) => {
    setActivePreset(presetId);
    if (presetId === 'custom') {
      onFieldsChange([]);
    } else {
      const preset = PRESETS.find(p => p.id === presetId);
      if (preset) {
        onFieldsChange([...preset.fields]);
      }
    }
  };

  const handleAddField = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingField.name || !editingField.label) return;

    // Sanitize identifier names to avoid spaces and special symbols
    const nameId = editingField.name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');

    const newField: ExtractionField = {
      id: "f_" + Math.random().toString(36).substring(2, 9),
      name: nameId,
      label: editingField.label.trim(),
      type: editingField.type || 'string',
      description: editingField.description?.trim() || `O valor correspondente ao campo ${editingField.label}`,
      required: !!editingField.required
    };

    onFieldsChange([...fields, newField]);
    setEditingField({
      name: '',
      label: '',
      type: 'string',
      description: '',
      required: false
    });
    setShowForm(false);
  };

  const handleRemoveField = (id: string) => {
    onFieldsChange(fields.filter(f => f.id !== id));
    setActivePreset('custom');
  };

  return (
    <div className="bg-sand-200 border-2 border-dark-900 rounded-none shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b-2 border-dark-900 flex items-center justify-between bg-dark-900 text-sand-100">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-brand-orange" />
          <h2 className="text-xs font-bold uppercase tracking-widest font-mono">Modelo de Extração OCR</h2>
        </div>
        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-none bg-brand-orange text-dark-900 border border-dark-900 flex items-center gap-1">
          <Sparkles className="w-3 h-3" />
          ESQUEMA ATIVO
        </span>
      </div>

      <div className="p-4 space-y-5">
        {/* Preset list */}
        <div>
          <label className="block text-[10px] font-bold text-dark-900 uppercase tracking-widest mb-2 font-mono">
            [01] Tipo de Documento / Template
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {PRESETS.map((p) => {
              const IconComp = p.icon;
              const isSelected = activePreset === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id)}
                  className={`flex flex-col items-center justify-center p-2 border-2 border-dark-900 text-center transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-brand-orange text-dark-900 font-bold shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]'
                      : 'bg-sand-100 text-dark-900 hover:bg-sand-350 opacity-80'
                  }`}
                >
                  <IconComp className="w-4 h-4 mb-1 text-dark-900" />
                  <span className="text-[9px] font-mono font-bold uppercase tracking-tighter truncate max-w-full">{p.shortName}</span>
                </button>
              );
            })}
            <button
              onClick={() => applyPreset('custom')}
              className={`flex flex-col items-center justify-center p-2.5 rounded-none border-2 border-dark-900 text-center transition-colors cursor-pointer ${
                activePreset === 'custom'
                  ? 'bg-brand-orange text-dark-900 font-bold shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]'
                  : 'bg-sand-100 text-dark-900 hover:bg-sand-350 opacity-80'
              }`}
            >
              <div className="font-mono font-bold text-xs text-dark-900 mb-0.5">
                [+]
              </div>
              <span className="text-[10px] font-mono font-bold uppercase tracking-tighter">Personalizado</span>
            </button>
          </div>
        </div>

        {/* Selected Fields Table */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <label className="block text-[10px] font-bold text-dark-900 uppercase tracking-widest font-mono">
              [02] Metadados Mapeados ({fields.length})
            </label>
            <button
              onClick={() => setShowForm(!showForm)}
              className="text-[10px] font-bold text-dark-900 hover:text-brand-orange bg-sand-100 px-2 py-0.5 border border-dark-900 flex items-center gap-1 cursor-pointer transition-colors"
            >
              <Plus className="w-3 h-3" /> ADICIONAR CAMPO
            </button>
          </div>

          {showForm && (
            <form onSubmit={handleAddField} className="bg-sand-100 p-3.5 border-2 border-dark-900 rounded-none space-y-3 font-mono">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[9px] font-bold uppercase mb-1">Nome Exibição</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Valor Desconto"
                    value={editingField.label}
                    onChange={e => {
                      const lab = e.target.value;
                      const proposedId = lab.toLowerCase()
                        .normalize("NFD")
                        .replace(/[\u0300-\u036f]/g, "")
                        .replace(/\s+/g, "_")
                        .replace(/[^a-z0-9_]/g, "");
                      setEditingField(prev => ({ ...prev, label: lab, name: proposedId }));
                    }}
                    className="w-full text-xs px-2 py-1.5 border border-dark-900 bg-white font-mono rounded-none focus:outline-hidden text-dark-900"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold uppercase mb-1">ID Técnico</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: valor_desconto"
                    value={editingField.name}
                    onChange={e => setEditingField(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full text-xs px-2 py-1.5 border border-dark-900 bg-white font-mono rounded-none focus:outline-hidden text-dark-900"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold uppercase mb-1">Tipo do Dado</label>
                  <select
                    value={editingField.type}
                    onChange={e => setEditingField(prev => ({ ...prev, type: e.target.value as any }))}
                    className="w-full text-xs px-1.5 py-1.5 border border-dark-900 bg-white font-mono rounded-none focus:outline-hidden text-dark-900"
                  >
                    <option value="string">Texto / Caractere</option>
                    <option value="currency">Financeiro (R$)</option>
                    <option value="number">Numérico (Decimal)</option>
                    <option value="date">Data (Formato)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-bold uppercase mb-1">Dica/Instrução OCR para o Gemini AI</label>
                <input
                  type="text"
                  placeholder="Instruções para localizar no PDF. Ex: 'O valor líquido total descontadas taxas'"
                  value={editingField.description}
                  onChange={e => setEditingField(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full text-xs px-2 py-1.5 border border-dark-900 bg-white rounded-none focus:outline-hidden text-dark-900"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="req_check"
                  checked={editingField.required}
                  onChange={e => setEditingField(prev => ({ ...prev, required: e.target.checked }))}
                  className="rounded-none border-dark-900 text-dark-900 focus:ring-0 h-3.5 w-3.5 cursor-pointer accent-dark-900"
                />
                <label htmlFor="req_check" className="text-[10px] font-bold cursor-pointer">Campo Obrigatório no PDF</label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-dark-900/10">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-2.5 py-1 text-[10px] font-bold bg-sand-200 hover:bg-sand-350 border border-dark-900 cursor-pointer text-dark-900"
                >
                  CANCELAR
                </button>
                <button
                  type="submit"
                  className="px-2.5 py-1 text-[10px] font-bold text-sand-100 bg-dark-900 hover:bg-brand-orange hover:text-dark-900 border border-dark-900 cursor-pointer"
                >
                  CONFIRMAR CAMPO
                </button>
              </div>
            </form>
          )}

          {fields.length === 0 ? (
            <div className="text-center py-5 text-dark-900/60 font-mono text-[10px] border-2 border-dashed border-dark-900/40 bg-sand-100">
              NENHUM METADADO DEFINIDO. CADASTRE UM NOVO CAMPO ACIMA.
            </div>
          ) : (
            <div className="overflow-x-auto border border-dark-900 bg-white shadow-xs max-h-[175px] overflow-y-auto">
              <table className="w-full text-[10px] text-left font-mono">
                <thead className="bg-[#141414] text-[#E4E3E0] uppercase border-b border-dark-900 sticky top-0">
                  <tr>
                    <th className="px-2.5 py-1.5 font-bold">Variável</th>
                    <th className="px-2.5 py-1.5 font-bold">Título</th>
                    <th className="px-2.5 py-1.5 font-bold">Tipo</th>
                    <th className="px-2.5 py-1.5 font-bold text-center">Obrig</th>
                    <th className="px-2.5 py-1.5 text-right font-bold">Remover</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-900/20 text-dark-900 bg-sand-100/30">
                  {fields.map((field) => (
                    <tr key={field.id} className="hover:bg-brand-orange/5">
                      <td className="px-2.5 py-1.5 font-semibold text-dark-900 max-w-[100px] truncate">{field.name}</td>
                      <td className="px-2.5 py-1.5 font-bold text-dark-900 max-w-[100px] truncate">{field.label}</td>
                      <td className="px-2.5 py-1.5">
                        <span className={`px-1 py-0.2 text-[9px] font-bold border border-dark-900 ${
                          field.type === 'currency' ? 'bg-emerald-100 text-[#141414]' :
                          field.type === 'date' ? 'bg-amber-100 text-[#141414]' :
                          field.type === 'number' ? 'bg-blue-100 text-[#141414]' :
                          'bg-white text-dark-900'
                        }`}>
                          {field.type === 'currency' ? 'BRL' :
                           field.type === 'date' ? 'DATA' :
                           field.type === 'number' ? 'NUM' : 'TXT'}
                        </span>
                      </td>
                      <td className="px-2.5 py-1.5 text-center font-bold">
                        {field.required ? 'SIM' : 'NÃO'}
                      </td>
                      <td className="px-2.5 py-1.5 text-right">
                        <button
                          onClick={() => handleRemoveField(field.id)}
                          className="text-rose-600 hover:text-white hover:bg-rose-600 border border-transparent hover:border-dark-900 p-0.5 cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
