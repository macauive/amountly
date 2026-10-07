import { supportedReceiptCurrencies, type ReceiptFileCaptureResult } from '@/lib/ai/receipt-contract'

export function isSupportedReceiptCurrency(value: string): value is typeof supportedReceiptCurrencies[number] {
  return (supportedReceiptCurrencies as readonly string[]).includes(value)
}

// Unknown monetary/date values must remain blank for a person's review.
export function receiptExpenseFields(result: ReceiptFileCaptureResult) {
  if (result.document_type !== 'receipt') return null
  return {
    amount: result.amount,
    currency: isSupportedReceiptCurrency(result.currency) ? result.currency : '',
    merchant: result.merchant,
    description: result.description,
    expense_date: result.expense_date,
    category: result.category,
  }
}

type ReceiptCandidate = { amount: string; currency: string; merchant: string; expense_date: string }
type ExistingExpense = { id: string; amount: number; currency: string; merchant?: string; expense_date: string }

export function receiptDraftIsComplete(candidate: Pick<ReceiptCandidate, 'amount' | 'currency' | 'expense_date'>) {
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(candidate.amount) || Number(candidate.amount) <= 0
    || !isSupportedReceiptCurrency(candidate.currency) || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.expense_date)) return false
  const date = new Date(`${candidate.expense_date}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === candidate.expense_date
}

export function expenseTotalsByCurrency(expenses: readonly Pick<ExistingExpense, 'amount' | 'currency'>[]) {
  const totals = new Map<string, number>()
  for (const expense of expenses) {
    if (Number.isFinite(expense.amount)) totals.set(expense.currency, (totals.get(expense.currency) ?? 0) + expense.amount)
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => ({ currency, amount }))
}

function normalizedMerchant(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

// This is a warning using already-authorized, loaded records, never an import veto.
export function findPossibleReceiptDuplicate(candidate: ReceiptCandidate, expenses: readonly ExistingExpense[], excludedId?: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(candidate.amount) || !isSupportedReceiptCurrency(candidate.currency)
    || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.expense_date)) return undefined
  const amount = Number(candidate.amount)
  const merchant = normalizedMerchant(candidate.merchant)
  if (!Number.isFinite(amount) || amount <= 0 || !merchant) return undefined
  return expenses.find(expense => expense.id !== excludedId
    && Number.isFinite(expense.amount) && expense.amount.toFixed(2) === amount.toFixed(2)
    && expense.currency === candidate.currency
    && expense.expense_date.slice(0, 10) === candidate.expense_date
    && normalizedMerchant(expense.merchant || '') === merchant)
}
