import { safeReturnHref } from '@/lib/record-search'
import { ExpenseCategory, ExpenseStatus } from '@/types/enums'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const receiptUploadHref = '/expenses?action=upload-receipt'
export function expenseHref(id: string, returnTo?: string) {
  if(!uuid.test(id))return '/expenses'
  const params=new URLSearchParams({expense:id})
  if(returnTo)params.set('returnTo',safeReturnHref(returnTo,'/expenses'))
  return '/expenses?'+params
}

export function expenseNavigation(params: URLSearchParams) {
  const expense = params.get('expense'), action = params.get('action'), status = params.get('status'), capture = params.get('capture')
  const invalid = ['expense', 'action', 'status', 'capture', 'q', 'start', 'end', 'category', 'review', 'returnTo'].some(key => params.getAll(key).length > 1)
    || (expense !== null && !uuid.test(expense)) || (action !== null && action !== 'upload-receipt')
    || [expense,action,capture].filter(value=>value!==null).length > 1
    || (capture !== null && !uuid.test(capture))
    || (params.has('q') && params.get('q')!.length > 100)
    || ['start','end'].some(key=>!!params.get(key)&&!validExpenseFilterDate(params.get(key)!))
    || (!!params.get('start') && !!params.get('end') && params.get('start')! > params.get('end')!)
    || (params.has('category') && !['all',...Object.values(ExpenseCategory)].includes(params.get('category')!))
    || (params.has('review') && !['all','needs-review','reviewed'].includes(params.get('review')!))
    || (status !== null && !Object.values(ExpenseStatus).includes(status as ExpenseStatus))
  return { invalid, expenseId: !invalid && expense ? expense.toLowerCase() : null,
    captureId: !invalid && capture ? capture.toLowerCase() : null,
    filters: { query: params.get('q') ?? '', start: params.get('start') ?? '', end: params.get('end') ?? '', category: params.get('category') ?? 'all', review: params.get('review') ?? 'all' },
    returnTo: safeReturnHref(params.get('returnTo'), '/expenses'),
    uploadReceipt: !invalid && action === 'upload-receipt', status: !invalid && status ? status : 'all' }
}

export type ExpenseListFilters = { query: string; start: string; end: string; category: string; status: string; review?: string }
type FilterableExpense = { merchant?: string; description?: string; expense_date: string; category: string; status: string; reviewed_at?: string | null }
export function expenseNeedsReview(expense: Pick<FilterableExpense, 'status' | 'reviewed_at'>) {
  return !expense.reviewed_at && [ExpenseStatus.draft, ExpenseStatus.rejected].includes(expense.status as ExpenseStatus)
}
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
    || (filters.status !== 'all' && !Object.values(ExpenseStatus).includes(filters.status as ExpenseStatus))
    || (filters.review !== undefined && !['all', 'needs-review', 'reviewed'].includes(filters.review))) return []
  const query = filters.query.slice(0, 100).normalize('NFKC').trim().toLocaleLowerCase('en-US')
  return expenses.filter(expense => (!query || `${expense.merchant ?? ''} ${expense.description ?? ''}`.normalize('NFKC').toLocaleLowerCase('en-US').includes(query))
    && (!filters.start || expense.expense_date.slice(0, 10) >= filters.start)
    && (!filters.end || expense.expense_date.slice(0, 10) <= filters.end)
    && (filters.category === 'all' || expense.category === filters.category)
    && (filters.status === 'all' || expense.status === filters.status)
    && (!filters.review || filters.review === 'all'
      || (filters.review === 'reviewed' ? !!expense.reviewed_at : expenseNeedsReview(expense))))
}

export function expenseFilterHref(filters: ExpenseListFilters) {
  const params = new URLSearchParams()
  for(const [key,value] of Object.entries({q:filters.query,start:filters.start,end:filters.end,category:filters.category,status:filters.status,review:filters.review??'all'})) if(value && value!=='all')params.set(key,value)
  return '/expenses'+(params.size?'?'+params.toString():'')
}
