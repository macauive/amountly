import { runAiTask } from '@/lib/ai/client'
import type { Bill, Expense, Invoice, TimeEntry, VendorBill } from '@/types/models'
import type { AccountType } from '@/types/enums'

export type AiNextStep = {
  id: string
  title: string
  detail: string
  href: string
  priority: 'high' | 'medium' | 'low'
}

export type MonthlySummary = {
  headline: string
  body: string
  highlights: string[]
}

export type FinancialSearchResult = {
  id: string
  title: string
  detail: string
  href: string
  label: string
  priority: AiNextStep['priority']
}

export type DashboardAiInsights = {
  nextSteps: AiNextStep[]
  monthlySummary: MonthlySummary
  searchResults: FinancialSearchResult[]
}

export async function getDashboardAiInsights(input: {
  accountType: AccountType
  searchQuery: string
  bills: Bill[]
  expenses: Expense[]
  workData: {
    invoices: Invoice[]
    expenses: Expense[]
    timeEntries: TimeEntry[]
    vendorBills: VendorBill[]
  }
  candidateHrefs: string[]
}): Promise<DashboardAiInsights> {
  // Do not send entire database rows (signed receipt links, addresses, ownership
  // fields or nested profiles) to the provider for summary generation.
  const expenses = (rows: Expense[]) => rows.map(row => ({
    id: row.id, label: row.merchant || row.description || 'Expense', amount: row.amount,
    date: row.expense_date, status: row.status, category: row.category, needsReceipt: !row.receipt_url,
  }))
  return runAiTask<DashboardAiInsights>('dashboard_insights', {
    accountType: input.accountType, searchQuery: input.searchQuery, candidateHrefs: input.candidateHrefs,
    bills: input.bills.map(row => ({ id: row.id, label: row.name, amount: row.amount, date: row.due_date, status: row.status })),
    expenses: expenses(input.expenses),
    workData: {
      invoices: input.workData.invoices.map(row => ({ id: row.id, label: row.invoice_number, amount: row.total, date: row.due_date, status: row.status })),
      expenses: expenses(input.workData.expenses),
      timeEntries: input.workData.timeEntries.map(row => ({ id: row.id, label: row.notes || 'Time entry', date: row.start_at, status: row.status })),
      vendorBills: input.workData.vendorBills.map(row => ({ id: row.id, label: row.bill_number, amount: row.total, date: row.due_date, status: row.status })),
    },
  })
}
