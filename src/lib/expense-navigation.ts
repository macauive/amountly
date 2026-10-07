import { ExpenseCategory, ExpenseStatus } from '@/types/enums'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const receiptUploadHref = '/expenses?action=upload-receipt'
export function expenseHref(id: string) {
  return uuid.test(id) ? `/expenses?expense=${encodeURIComponent(id)}` : '/expenses'
}

export function expenseNavigation(params: URLSearchParams) {
  const expense = params.get('expense'), action = params.get('action'), status = params.get('status')
  const invalid = ['expense', 'action', 'status'].some(key => params.getAll(key).length > 1)
    || (expense !== null && !uuid.test(expense)) || (action !== null && action !== 'upload-receipt')
    || (expense !== null && action !== null)
    || (status !== null && !Object.values(ExpenseStatus).includes(status as ExpenseStatus))
  return { invalid, expenseId: !invalid && expense ? expense.toLowerCase() : null,
    uploadReceipt: !invalid && action === 'upload-receipt', status: !invalid && status ? status : 'all' }
}

export type ExpenseListFilters = { query: string; start: string; end: string; category: string; status: string }
type FilterableExpense = { merchant?: string; description?: string; expense_date: string; category: string; status: string }
export function validExpenseFilterDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

// Filters only narrow records already returned through the authenticated service.
export function filterExpenseList<T extends FilterableExpense>(expenses: readonly T[], filters: ExpenseListFilters): T[] {
  if ((filters.start && !validExpenseFilterDate(filters.start)) || (filters.end && !validExpenseFilterDate(filters.end))
    || (filters.start && filters.end && filters.start > filters.end)
    || (filters.category !== 'all' && !Object.values(ExpenseCategory).includes(filters.category as ExpenseCategory))
    || (filters.status !== 'all' && !Object.values(ExpenseStatus).includes(filters.status as ExpenseStatus))) return []
  const query = filters.query.slice(0, 100).normalize('NFKC').trim().toLocaleLowerCase('en-US')
  return expenses.filter(expense => (!query || `${expense.merchant ?? ''} ${expense.description ?? ''}`.normalize('NFKC').toLocaleLowerCase('en-US').includes(query))
    && (!filters.start || expense.expense_date.slice(0, 10) >= filters.start)
    && (!filters.end || expense.expense_date.slice(0, 10) <= filters.end)
    && (filters.category === 'all' || expense.category === filters.category)
    && (filters.status === 'all' || expense.status === filters.status))
}
