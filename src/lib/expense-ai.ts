import { ExpenseCategory, expenseCategoryLabels } from '@/types/enums'
import { runAiTask } from '@/lib/ai/client'
import { getSupabaseClient } from '@/lib/supabase'
import { maxReceiptFileBytes, receiptFileResultSchema, type ReceiptFileCaptureResult } from '@/lib/ai/receipt-contract'

export type ExpenseCategorySuggestion = {
  category: ExpenseCategory
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

export type ExpenseSmartCaptureResult = {
  amount?: string
  merchant?: string
  description?: string
  expense_date?: string
  category: ExpenseCategory
  confidence: ExpenseCategorySuggestion['confidence']
  reason: string
}

export type ReceiptDocumentCaptureResult = ExpenseSmartCaptureResult & {
  notes?: string
  summary: string
}

export async function suggestExpenseCategory(input: {
  merchant?: string
  description?: string
  notes?: string
}): Promise<ExpenseCategorySuggestion> {
  const result = await runAiTask<ExpenseSmartCaptureResult>('expense_capture', input)
  return {
    category: result.category,
    confidence: result.confidence,
    reason: result.reason,
  }
}

export function getExpenseCategorySuggestionLabel(suggestion: ExpenseCategorySuggestion) {
  return expenseCategoryLabels[suggestion.category]
}

function emptyToUndefined(value: string | undefined) {
  return value?.trim() || undefined
}

export async function captureExpenseFromText(text: string): Promise<ExpenseSmartCaptureResult> {
  const result = await runAiTask<Required<ExpenseSmartCaptureResult>>('expense_capture', text)

  return {
    ...result,
    amount: emptyToUndefined(result.amount),
    merchant: emptyToUndefined(result.merchant),
    description: emptyToUndefined(result.description),
    expense_date: emptyToUndefined(result.expense_date),
  }
}

export async function captureReceiptDocumentFromText(text: string): Promise<ReceiptDocumentCaptureResult> {
  const result = await runAiTask<Required<ReceiptDocumentCaptureResult>>('receipt_capture', text)

  return {
    ...result,
    amount: emptyToUndefined(result.amount),
    merchant: emptyToUndefined(result.merchant),
    description: emptyToUndefined(result.description),
    expense_date: emptyToUndefined(result.expense_date),
    notes: emptyToUndefined(result.notes),
  }
}

export async function captureReceiptFromFile(file: File, signal?: AbortSignal): Promise<ReceiptFileCaptureResult> {
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  if (!allowedTypes.has(file.type)) throw new Error('Choose a JPEG, PNG, WebP, or PDF receipt.')
  if (file.size === 0 || file.size > maxReceiptFileBytes) throw new Error('Choose a receipt between 1 byte and 10 MB.')
  signal?.throwIfAborted()
  const { data: { session }, error } = await getSupabaseClient().auth.getSession()
  if (error || !session?.user) throw new Error('Sign in to use AI.')
  signal?.throwIfAborted()
  const response = await fetch('/api/ai/receipt', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers: {
      'Content-Type': file.type,
      ...(session.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    // The file name stays in this form; only the selected bytes are submitted.
    body: file,
  })
  if (!response.ok) {
    const errors: Record<number, string> = {
      400: 'Could not read this receipt. Try a clear image or an unlocked PDF of up to 5 pages.',
      401: 'Sign in to use AI.',
      403: 'You do not have access to this receipt extraction.',
      413: 'Choose a receipt no larger than 10 MB and a PDF of up to 5 pages.',
      415: 'Choose a valid JPEG, PNG, WebP, or PDF receipt.',
      429: 'AI usage limit reached. Please try again later.',
    }
    throw new Error(errors[response.status] || 'Receipt extraction is temporarily unavailable. Try again later.')
  }
  const body = await response.json().catch(() => null)
  const parsed = receiptFileResultSchema.safeParse(body?.result)
  if (!parsed.success) throw new Error('Could not validate the extracted receipt. Please try again.')
  signal?.throwIfAborted()
  return parsed.data
}
