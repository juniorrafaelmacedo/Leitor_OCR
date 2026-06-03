import React, { useState } from 'react';
import { QueueItem, ExtractionField } from '../types';
import { Search, Download, Trash2, Edit2, Check, FileText, CheckSquare, Square, Eye } from 'lucide-react';
import * as XLSX from 'xlsx';

interface CatalogTableProps {
  queue: QueueItem[];
  fields: ExtractionField[];
  onUpdateRow: (id: string, updatedData: Record<string, any>) => void;
  onDeleteRow: (id: string) => void;
  onViewDetails: (item: QueueItem) => void;
}

export const CatalogTable: React.FC<CatalogTableProps> = ({
  queue,
  fields,
  onUpdateRow,
  onDeleteRow,
  onViewDetails,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [editingCell, setEditingCell] = useState<{ rowId: string, fieldName: string } | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});

  // Get only completed processes for database grid representation
  const completedItems = queue.filter(item => item.status === 'completed');

  // Multi-field search filtering
  const filteredItems = completedItems.filter(item => {
    const matchFileName = item.fileName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchExtracted = fields.some(f => {
      const val = item.extractedData?.[f.name];
      return val ? String(val).toLowerCase().includes(searchTerm.toLowerCase()) : false;
    });
    return matchFileName || matchExtracted;
  });

  const handleStartEdit = (rowId: string, fieldName: string, currentValue: any) => {
    setEditingCell({ rowId, fieldName });
    setEditingValue(String(currentValue || ''));
  };

  const handleSaveEdit = (rowId: string, fieldName: string) => {
    onUpdateRow(rowId, { [fieldName]: editingValue });
    setEditingCell(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, rowId: string, fieldName: string) => {
    if (e.key === 'Enter') {
      handleSaveEdit(rowId, fieldName);
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  };

  // Toggle single row selection
  const toggleRowSelect = (id: string) => {
    setSelectedRows(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Toggle selection for all filtered rows
  const toggleSelectAll = () => {
    const areAllSelected = filteredItems.length > 0 && filteredItems.every(item => selectedRows[item.id]);
    const nextSelectState: Record<string, boolean> = {};
    if (!areAllSelected) {
      filteredItems.forEach(item => {
        nextSelectState[item.id] = true;
      });
    }
    setSelectedRows(nextSelectState);
  };

  // Export utility for Microsoft Excel
  const exportToExcel = () => {
    if (completedItems.length === 0) return;

    // Define export cohort (either selected rows or all filtered rows)
    const activeSelection = Object.keys(selectedRows).filter(k => selectedRows[k] && queue.some(q => q.id === k));
    const itemsToExport = activeSelection.length > 0 
      ? completedItems.filter(item => activeSelection.includes(item.id))
      : filteredItems;

    const dataToExport = itemsToExport.map((row, idx) => {
      const sheetRow: Record<string, any> = {
        'Index': idx + 1,
        'Nome do Arquivo': row.fileName,
        'Tamanho (KB)': (row.fileSize / 1024).toFixed(1),
        'Data de Processamento': row.processedAt ? new Date(row.processedAt).toLocaleString('pt-BR') : 'N/A',
      };

      // Extract each field schema dynamically
      fields.forEach(f => {
        sheetRow[f.label] = row.extractedData?.[f.name] || '';
      });

      sheetRow['Resumo Inteligente Google AI'] = row.rawSummary || '';
      return sheetRow;
    });

    // Generate sheet & workbook structure
    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Dados Extraídos OCR");

    // Adjust column widths automatically
    const max_len = dataToExport.reduce((w, r) => {
      Object.keys(r).forEach((k, idx) => {
        const valueLength = String(r[k]).length;
        if (!w[idx] || w[idx] < valueLength) {
          w[idx] = Math.max(valueLength, k.length);
        }
      });
      return w;
    }, [] as number[]);
    worksheet["!cols"] = max_len.map(l => ({ wch: l + 3 }));

    // Trigger local download
    const dateFormatted = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `catalogo_ocr_excel_${dateFormatted}.xlsx`);
  };

  // Export to CSV standard format
  const exportToCsv = () => {
    if (completedItems.length === 0) return;

    const activeSelection = Object.keys(selectedRows).filter(k => selectedRows[k]);
    const itemsToExport = activeSelection.length > 0 
      ? completedItems.filter(item => activeSelection.includes(item.id))
      : filteredItems;

    const headers = ['Nome do Arquivo', ...fields.map(f => f.label), 'Resumo Inteligente'];
    const csvRows = [headers.join(';')];

    itemsToExport.forEach(row => {
      const values = [
        `"${row.fileName.replace(/"/g, '""')}"`,
        ...fields.map(f => `"${String(row.extractedData?.[f.name] || '').replace(/"/g, '""')}"`),
        `"${String(row.rawSummary || '').replace(/"/g, '""')}"`
      ];
      csvRows.push(values.join(';'));
    });

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + csvRows.join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const dateFormatted = new Date().toISOString().split('T')[0];
    link.setAttribute("download", `catalogo_ocr_csv_${dateFormatted}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isAllSelected = filteredItems.length > 0 && filteredItems.every(item => selectedRows[item.id]);
  const selectedCount = Object.keys(selectedRows).filter(k => selectedRows[k]).length;
  return (
    <div className="space-y-4">
      {/* Table Toolbar Container */}
      <div className="p-4 border-2 border-dark-900 bg-sand-200 rounded-none flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
        <div className="font-mono">
          <h3 className="text-xs font-bold text-dark-900 uppercase tracking-widest flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-brand-orange" />
            [03] Catálogo de Informações Extrusadas ({completedItems.length} Registros)
          </h3>
          <p className="text-[10px] text-dark-900/60 leading-relaxed font-bold">
            Dê duplo clique em qualquer célula de dados para ajustar valores diretamente.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search box */}
          <div className="relative font-mono">
            <Search className="w-3.5 h-3.5 text-dark-900 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filtro de busca..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-8 pr-2.5 py-1.5 text-xs border-2 border-dark-900 rounded-none bg-white font-mono focus:outline-hidden text-dark-900 w-full sm:w-[180px]"
            />
          </div>

          {/* Export buttons */}
          <button
            onClick={exportToExcel}
            disabled={completedItems.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 bg-dark-900 text-sand-100 hover:bg-brand-orange hover:text-dark-900 disabled:bg-sand-100 disabled:text-dark-900/40 disabled:border-dark-900/20 disabled:shadow-none border-2 border-dark-900 rounded-none text-xs font-mono font-bold uppercase tracking-tight cursor-pointer disabled:cursor-not-allowed transition-all shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]"
          >
            <Download className="w-3.5 h-3.5" />
            GERAR EXCEL {selectedCount > 0 ? `(${selectedCount})` : ''}
          </button>
          
          <button
            onClick={exportToCsv}
            disabled={completedItems.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 bg-sand-100 text-dark-900 hover:bg-brand-orange hover:text-dark-900 disabled:opacity-50 border-2 border-dark-900 rounded-none text-xs font-mono font-bold uppercase tracking-tight cursor-pointer transition-all shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]"
          >
            CSV
          </button>
        </div>
      </div>

      {completedItems.length === 0 ? (
        <div className="text-center py-10 px-4 bg-white border-2 border-dark-900 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] rounded-none space-y-2">
          <div className="w-10 h-10 bg-sand-200 border border-dark-900 text-dark-900 rounded-none flex items-center justify-center mx-auto">
            <FileText className="w-5 h-5 text-dark-900" />
          </div>
          <h4 className="text-xs font-mono font-bold uppercase text-dark-900">Catalisador Vazio / Sem Dados OCR</h4>
          <p className="text-[10px] font-mono text-dark-900/60 max-w-sm mx-auto leading-relaxed">
            Submeta seus PDFs no painel de enfileiramento na seção superior da aplicação. O processamento alimentará este catálogo dinamicamente.
          </p>
        </div>
      ) : (
        <div className="border-2 border-dark-900 bg-white rounded-none shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
          <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
            <table className="w-full text-left font-mono text-[11px] leading-tight border-collapse">
              <thead className="sticky top-0 bg-[#141414] text-[#E4E3E0] uppercase text-[10px] font-bold tracking-wider border-b border-dark-900 z-10">
                <tr>
                  <th className="p-2.5 w-8 text-center border-r border-[#141414]/20">
                    <button onClick={toggleSelectAll} className="text-[#E4E3E0] hover:text-brand-orange cursor-pointer transition-colors block mx-auto">
                      {isAllSelected ? (
                        <CheckSquare className="w-3.5 h-3.5 text-brand-orange" />
                      ) : (
                        <Square className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </th>
                  <th className="p-2.5 font-bold border-r border-[#141414]/20 whitespace-nowrap">DOCUMENTO</th>
                  {fields.map(f => (
                    <th key={f.id} className="p-2.5 font-bold border-r border-[#141414]/20 whitespace-nowrap">
                      {f.label.toUpperCase()}
                    </th>
                  ))}
                  <th className="p-2.5 font-bold border-r border-[#141414]/20 whitespace-nowrap">EXTRATO INTELIGENTE</th>
                  <th className="p-2.5 text-right font-bold w-20">AÇÃO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-900/20 text-dark-900 bg-white">
                {filteredItems.map(row => {
                  const isSelected = !!selectedRows[row.id];
                  return (
                    <tr key={row.id} className={`border-b border-dark-900/10 hover:bg-brand-orange/5 transition-colors duration-150 ${isSelected ? 'bg-brand-orange/10' : ''}`}>
                      <td className="p-2 text-center border-r border-dark-900/10">
                        <button onClick={() => toggleRowSelect(row.id)} className="text-dark-900 hover:text-brand-orange cursor-pointer block mx-auto">
                          {isSelected ? (
                            <CheckSquare className="w-3.5 h-3.5 text-[#141414]" />
                          ) : (
                            <Square className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </td>
                      <td className="p-2.5 font-bold text-dark-900 border-r border-dark-900/10 max-w-[150px]" title={row.fileName}>
                        <div className="truncate font-black">{row.fileName}</div>
                        {row.extractionMethod === 'direct' ? (
                          <span className="inline-block mt-1 px-1.5 py-0.5 text-[7.5px] font-black uppercase text-[#155e75] bg-[#ecfeff] border border-[#a5f3fc] rounded-none">
                            ⚡ TEXTO DIGITAL
                          </span>
                        ) : row.extractionMethod === 'ocr-space-only' ? (
                          <span className="inline-block mt-1 px-1.5 py-0.5 text-[7.5px] font-black uppercase text-pink-900 bg-pink-50 border border-pink-200 rounded-none">
                            🚀 APENAS OCR SPACE (SEM IA)
                          </span>
                        ) : row.extractionMethod === 'ocr-space' ? (
                          <span className="inline-block mt-1 px-1.5 py-0.5 text-[7.5px] font-black uppercase text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-none">
                            🪐 OCR SPACE + IA
                          </span>
                        ) : (
                          <span className="inline-block mt-1 px-1.5 py-0.5 text-[7.5px] font-black uppercase text-[#854d0e] bg-[#fef9c3] border border-[#fef08a] rounded-none">
                            ✨ GEMINI IA
                          </span>
                        )}
                      </td>

                      {/* Columns dynamically rendered from Fields schema */}
                      {fields.map(f => {
                        const value = row.extractedData?.[f.name] || '';
                        const isEditing = editingCell?.rowId === row.id && editingCell?.fieldName === f.name;

                        return (
                          <td
                            key={f.id}
                            onDoubleClick={() => handleStartEdit(row.id, f.name, value)}
                            className="p-2 border-r border-dark-900/10 relative max-w-[160px] group cursor-text"
                          >
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  value={editingValue}
                                  onChange={e => setEditingValue(e.target.value)}
                                  onKeyDown={e => handleKeyDown(e, row.id, f.name)}
                                  onBlur={() => handleSaveEdit(row.id, f.name)}
                                  className="w-full text-[10px] p-0.5 border border-dark-900 bg-white font-mono focus:outline-hidden text-dark-900"
                                  autoFocus
                                />
                                <button
                                  onClick={() => handleSaveEdit(row.id, f.name)}
                                  className="p-0.5 bg-dark-900 text-brand-orange hover:bg-brand-orange hover:text-dark-900 border border-dark-900 cursor-pointer"
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between gap-1 overflow-hidden">
                                <span className="truncate leading-tight block w-full whitespace-nowrap font-semibold">
                                  {f.type === 'currency' && value && !String(value).includes('R$') ? `R$ ${value}` : value || '-'}
                                </span>
                                <button
                                  onClick={() => handleStartEdit(row.id, f.name, value)}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-dark-900/40 hover:text-dark-900 hover:bg-sand-200 cursor-pointer"
                                >
                                  <Edit2 className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        );
                      })}

                      <td className="p-2.5 text-dark-900/60 font-medium border-r border-dark-900/10 max-w-[160px] truncate italic" title={row.rawSummary}>
                        {row.rawSummary || '-'}
                      </td>

                      <td className="p-2 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1 px-1">
                          <button
                            onClick={() => onViewDetails(row)}
                            className="p-1 hover:bg-brand-orange hover:text-dark-900 text-dark-900 border border-transparent hover:border-dark-900 transition-colors cursor-pointer"
                            title="Visualizar Resumo Completo"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onDeleteRow(row.id)}
                            className="p-1 hover:bg-rose-600 hover:text-white text-rose-600 border border-transparent hover:border-dark-900 transition-colors cursor-pointer"
                            title="Excluir Registro"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="bg-[#141414] text-[#E4E3E0] h-9 flex items-center px-4 justify-between font-mono text-[9px] border-t border-dark-900 select-none">
            <div className="flex gap-4">
              <span className="font-bold">TOTAL COMPLETED: {completedItems.length}</span>
              <span className="font-bold">SELECTED: {selectedCount}</span>
            </div>
            <div className="flex items-center gap-1.5 font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span> <span>RECORDS SYNCHRONIZED</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
