export interface ExtractionField {
  id: string;
  name: string; // The key in JSON, e.g., 'invoice_number'
  label: string; // User-facing label, e.g., 'Número da Fatura'
  type: 'string' | 'number' | 'date' | 'currency';
  description: string; // Explanation for Gemini, e.g., 'The unique code or number identifying the invoice'
  required: boolean;
}

export type QueueItemStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface QueueItem {
  id: string;
  fileName: string;
  fileSize: number;
  status: QueueItemStatus;
  progress: number;
  error?: string;
  retryMessage?: string;
  extractedData?: Record<string, any>;
  rawSummary?: string;
  uploadedAt: string;
  processedAt?: string;
  extractionMethod?: 'direct' | 'ai' | 'ocr-space' | 'ocr-space-only';
}

export interface ProcessingStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}
