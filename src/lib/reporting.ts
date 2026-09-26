import type { Expense, Invoice } from '@/types/models'

export type IncomeBasis = 'cash' | 'accrual'
export function incomeRecords(invoices: Invoice[], year: number, currency: string, basis: IncomeBasis) {
  const inYear = (date: string) => date.slice(0, 4) === String(year)
  return invoices.filter(invoice => invoice.currency === currency && !['DRAFT', 'CANCELLED'].includes(invoice.status)).flatMap(invoice => {
    if (basis === 'accrual') return inYear(invoice.issue_date) ? [{ id: invoice.id, invoice_id: invoice.id, name: invoice.invoice_number, date: invoice.issue_date, amount: invoice.total, status: invoice.status, currency }] : []
    return (invoice.payments ?? []).filter(payment => !payment.reversal && inYear(payment.paid_on)).map(payment => ({ id: payment.id, invoice_id: invoice.id, name: invoice.invoice_number, date: payment.paid_on, amount: payment.amount, status: 'RECEIVED', currency }))
  })
}
export function expenseRecords(expenses: Expense[], year: number, currency: string) {
  return expenses.filter(expense => expense.expense_date.slice(0, 4) === String(year) && expense.currency === currency && expense.status !== 'REJECTED')
}
export function sumMoney(rows: { amount: number }[]) { return rows.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0) / 100 }

// Reviewed against IRS Revenue Procedure 2025-32 and SSA contribution bases.
// Illustrative single-filer ordinary income only. No credits, QBI, state taxes,
// additional Medicare, other wages, capital gains, or payment-safe-harbor advice.
export const taxSources = {
  irs: 'https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill',
  ssa: 'https://www.ssa.gov/oact/COLA/cbb.html',
  deadlines: 'https://www.irs.gov/publications/p505',
}
const taxYears: Record<number, { deduction: number; ssBase: number; limits: number[] }> = {
  2025: { deduction: 15750, ssBase: 176100, limits: [11925, 48475, 103350, 197300, 250525, 626350, Infinity] },
  2026: { deduction: 16100, ssBase: 184500, limits: [12400, 50400, 105700, 201775, 256225, 640600, Infinity] },
}
export function supportedTaxYear(year: number) { return Object.hasOwn(taxYears, year) }
export function estimateFederalTax(income: number, year: number) {
  const config = taxYears[year]
  if (!config || !Number.isFinite(income)) throw new Error('Unsupported tax estimate')
  const taxable = Math.max(0, income - config.deduction)
  let previous = 0, total = 0
  config.limits.forEach((limit, index) => { total += Math.max(0, Math.min(taxable, limit) - previous) * [.1, .12, .22, .24, .32, .35, .37][index]; previous = limit })
  return total
}
export function estimateSETax(netEarnings: number, year: number) {
  const config = taxYears[year]
  if (!config || !Number.isFinite(netEarnings)) throw new Error('Unsupported tax estimate')
  return netEarnings < 400 ? 0 : Math.min(netEarnings, config.ssBase) * .124 + netEarnings * .029
}
export function taxQuarters(year: number) {
  if (!supportedTaxYear(year)) throw new Error('Deadlines for this year need review before use')
  return [
    { label: 'Q1', period: `Jan 1 – Mar 31, ${year}`, start: `${year}-01-01`, end: `${year}-03-31`, dueDate: `${year}-04-15` },
    { label: 'Q2', period: `Apr 1 – May 31, ${year}`, start: `${year}-04-01`, end: `${year}-05-31`, dueDate: `${year}-06-${year === 2025 ? '16' : '15'}` },
    { label: 'Q3', period: `Jun 1 – Aug 31, ${year}`, start: `${year}-06-01`, end: `${year}-08-31`, dueDate: `${year}-09-15` },
    { label: 'Q4', period: `Sep 1 – Dec 31, ${year}`, start: `${year}-09-01`, end: `${year}-12-31`, dueDate: `${year + 1}-01-15` },
  ]
}
