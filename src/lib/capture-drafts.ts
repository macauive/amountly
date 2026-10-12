import { z } from 'zod/v3'
import { ExpenseCategory } from '@/types/enums'
import { receiptFileResultSchema, supportedReceiptCurrencies, receiptMimeTypes } from '@/lib/ai/receipt-contract'

export const captureFieldsSchema = z.object({
  amount: z.union([z.literal(''), z.string().max(12).regex(/^\d{0,8}(?:\.\d{0,2})?$/)]),
  currency: z.enum(['', ...supportedReceiptCurrencies]),
  category: z.nativeEnum(ExpenseCategory),
  description: z.string().max(1000), merchant: z.string().max(200),
  expense_date: z.union([z.literal(''), z.string().date()]),
  project_id: z.union([z.literal(''), z.string().uuid()]), notes: z.string().max(4000),
}).strict()
export const capturePayloadSchema = z.object({
  method: z.enum(['file', 'text', 'manual']), fields: captureFieldsSchema,
  text: z.string().max(12000), extraction: receiptFileResultSchema.nullable(),
  extracted: z.boolean(),
}).strict()
export const captureWriteSchema = z.object({
  id: z.string().uuid(), revision: z.number().int().min(0).max(2147483646),
  payload: capturePayloadSchema,
}).strict()
export const captureDraftSchema = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(),
  updated_at: z.string().datetime({ offset: true }), payload: capturePayloadSchema,
  file_name: z.string().max(200).nullable(), content_type: z.enum(receiptMimeTypes).nullable(),
}).strict()
export type CapturePayload = z.infer<typeof capturePayloadSchema>
export type CaptureDraft = z.infer<typeof captureDraftSchema>

export function captureDraftHref(id: string) {
  return z.string().uuid().safeParse(id).success ? `/expenses?capture=${encodeURIComponent(id)}` : '/expenses'
}
