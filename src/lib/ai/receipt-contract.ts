import { z } from 'zod/v3'
import { ExpenseCategory } from '@/types/enums'

export const maxReceiptFileBytes = 10 * 1024 * 1024
export const maxReceiptPdfPages = 5
export const supportedReceiptCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'] as const
export const receiptMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const

// Extraction is a proposal. Empty values deliberately require a person's input.
export const receiptFileResultSchema = z.object({
  document_type: z.enum(['receipt', 'invoice', 'statement', 'other']),
  amount: z.union([z.literal(''), z.string().max(12).regex(/^\d{1,8}(\.\d{1,2})?$/)]),
  currency: z.enum(['', ...supportedReceiptCurrencies, 'OTHER']),
  merchant: z.string().trim().max(200),
  description: z.string().trim().max(1000),
  expense_date: z.union([z.literal(''), z.string().date()]),
  category: z.nativeEnum(ExpenseCategory),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string().trim().max(1000),
  summary: z.string().trim().max(1000),
}).strict()

export type ReceiptFileCaptureResult = z.infer<typeof receiptFileResultSchema>

export const receiptFileJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['document_type', 'amount', 'currency', 'merchant', 'description', 'expense_date', 'category', 'confidence', 'reason', 'summary'],
  properties: {
    document_type: { type: 'string', enum: ['receipt', 'invoice', 'statement', 'other'] },
    amount: { type: 'string', pattern: '^(?:[0-9]{1,8}(?:\\.[0-9]{1,2})?)?$', description: 'Total actually paid. Numeric decimal only, no currency symbols or commas; empty if missing or ambiguous.' },
    currency: { type: 'string', enum: ['', ...supportedReceiptCurrencies, 'OTHER'], description: 'Explicit currency code. Empty if missing or ambiguous (a dollar sign alone is ambiguous); OTHER for an explicitly identified unsupported currency.' },
    merchant: { type: 'string', maxLength: 200 },
    description: { type: 'string', maxLength: 1000 },
    expense_date: { type: 'string', description: 'Unambiguous transaction date in YYYY-MM-DD, or empty. Never use today as a default.' },
    category: { type: 'string', enum: Object.values(ExpenseCategory) },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reason: { type: 'string', maxLength: 1000 },
    summary: { type: 'string', maxLength: 1000 },
  },
} as const
