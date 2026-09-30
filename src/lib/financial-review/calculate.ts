import { periodSchema, snapshotSchema, day, cents, addDays, type Period, ReviewError } from '@/lib/financial-review/contracts'
import { mapInvoice } from '@/lib/invoice-records'
import { effectiveBillStatus } from '@/lib/bill-status'
import { BillStatus } from '@/types/enums'

export function calculateReview(input: unknown, periodInput: Period, asOfInput: string) {
  const period = periodSchema.parse(periodInput), asOf = day.parse(asOfInput), rows = snapshotSchema.parse(input)
  const now = new Date(`${asOf}T12:00:00`), horizon = addDays(asOf, 7)
  const source = (kind: string, id: string, label: string) => ({ kind, id, label: label.slice(0, 160),
    href: kind === 'invoices' ? `/invoices/${id}` : `/financial-review/record?kind=${kind}&id=${id}` })
  const unpaid = rows.invoices.filter(i => i.currency === period.currency && ['SENT', 'OVERDUE'].includes(i.status)).map(i => {
    const invoice = mapInvoice({ ...i, payments: rows.payments.filter(p => p.invoice_id === i.id) })
    return { source: source('invoices', i.id, i.invoice_number), amount: invoice.balance_due ?? 0, due: i.due_date, overdue: i.due_date < asOf }
  }).filter(i => i.amount > 0).sort((a, b) => a.due.localeCompare(b.due) || a.source.id.localeCompare(b.source.id))
  const obligations = rows.bills.filter(b => b.currency === period.currency && !['paid', 'cancelled'].includes(b.status) && b.due_date <= horizon)
    .map(b => ({ source: source(b.kind, b.id, b.name), amount: b.amount, due: b.due_date,
      overdue: effectiveBillStatus({ status: b.status as BillStatus, due_date: b.due_date }, now) === BillStatus.overdue }))
    .sort((a, b) => a.due.localeCompare(b.due) || a.source.id.localeCompare(b.source.id))
  const expenses = rows.expenses.filter(e => e.currency === period.currency && e.archived_at === null && e.status !== 'REJECTED')
  const inPeriod = expenses.filter(e => e.expense_date >= period.start && e.expense_date <= period.end)
  const baselineStart = addDays(period.start, -90)
  const findings = [
    ...unpaid.filter(i => i.overdue).map(i => ({ id: `overdue:${i.source.id}`, title: 'Overdue invoice', detail: `Due ${i.due}; ${i.amount.toFixed(2)} ${period.currency} remains outstanding.`, source: i.source })),
    ...obligations.map(b => ({ id: `obligation:${b.source.id}`, title: b.overdue ? 'Past-due obligation' : 'Upcoming obligation', detail: `${b.amount.toFixed(2)} ${period.currency} due ${b.due}. Check payment arrangements before following up.`, source: b.source })),
    ...inPeriod.filter(e => !e.receipt_path?.trim() && !e.receipt_url?.trim()).map(e => ({ id: `receipt:${e.id}`, title: 'Missing receipt', detail: `No receipt reference is attached to this ${e.amount.toFixed(2)} ${period.currency} expense.`, source: source('expenses', e.id, e.description || 'Expense') })),
  ]
  for (const e of inPeriod) {
    if (!e.category) continue
    const baseline = expenses.filter(b => b.category === e.category && b.expense_date >= baselineStart && b.expense_date < period.start).map(b => cents(b.amount)).sort((a, b) => a - b)
    if (baseline.length < 3) continue
    const middle = Math.floor(baseline.length / 2)
    const median = baseline.length % 2 ? baseline[middle] : (baseline[middle - 1] + baseline[middle]) / 2
    if (cents(e.amount) >= Math.max(10000, median * 3) && cents(e.amount) > median) findings.push({ id: `unusual:${e.id}`, title: 'Expense worth checking',
      detail: `${e.amount.toFixed(2)} ${period.currency} is at least three times the previous 90-day category median (${(median / 100).toFixed(2)}; ${baseline.length} records). This is a comparison flag, not evidence of an error.`, source: source('expenses', e.id, e.description || 'Expense') })
  }
  const result = { period, asOf, horizon, unpaid, obligations, findings,
    totals: { unpaid: unpaid.reduce((n, i) => n + cents(i.amount), 0) / 100,
      obligations: obligations.reduce((n, b) => n + cents(b.amount), 0) / 100,
      expenses: inPeriod.reduce((n, e) => n + cents(e.amount), 0) / 100 },
    notes: ['Invoice balances and bill states are current, not reconstructed historical balances.',
      'Obligations include past-due bills and bills due in the next seven days. Expenses use the selected period.',
      'Unusual-expense flags require three prior category records. Receipt references do not prove receipt contents.'],
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 512000) throw new ReviewError(413, 'This review is too large to display safely. No partial totals were returned.')
  return result
}
export type FinancialReview = ReturnType<typeof calculateReview>
