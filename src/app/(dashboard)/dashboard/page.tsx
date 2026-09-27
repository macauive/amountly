'use client'

import { format } from 'date-fns'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useAppState } from '@/contexts/AppStateContext'
import { getBills } from '@/services/bills.service'
import { getExpenses } from '@/services/expenses.service'
import { getInvoices } from '@/services/invoices.service'
import { getTimeEntries } from '@/services/time-entries.service'
import { getVendorBills } from '@/services/accounts-payable.service'
import type { Bill, Expense, Invoice, TimeEntry, VendorBill } from '@/types/models'
import { AccountType, BillStatus, Capability, ExpenseCategory, ExpenseStatus, InvoiceStatus, expenseCategoryLabels } from '@/types/enums'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Clock,
  FileText,
  Receipt,
  CheckCircle,
  AlertCircle,
  CreditCard,
  CalendarClock,
  Wand2,
  ArrowRight,
  Search,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { getQuickActions } from '@/lib/quick-actions'
import { getDashboardAiInsights } from '@/lib/dashboard-ai'
import { addDays, differenceInCalendarDays, endOfMonth, formatDistanceToNow, isAfter, isBefore, parseISO, startOfMonth } from 'date-fns'

type DashboardStat = {
  title: string
  value: string
  change: string
  trend: 'up' | 'down'
  icon: typeof CalendarClock
}

type RecentActivity = {
  id: string
  message: string
  time: string
  status: 'success' | 'warning'
}

type AiNextStep = {
  id: string
  title: string
  detail: string
  href: string
  priority: 'high' | 'medium' | 'low'
}

type CloseChecklistItem = {
  id: string
  label: string
  detail: string
  href: string
  done: boolean
}

type MonthlySummary = {
  headline: string
  body: string
  highlights: string[]
}

type FinancialSearchResult = {
  id: string
  title: string
  detail: string
  href: string
  label: string
  priority: AiNextStep['priority']
}

type WorkDashboardData = {
  invoices: Invoice[]
  expenses: Expense[]
  timeEntries: TimeEntry[]
  vendorBills: VendorBill[]
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function formatHours(minutes: number) {
  const hours = minutes / 60
  if (hours === 0) return '0h'
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: hours < 10 ? 1 : 0 }).format(hours)}h`
}

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase()
}

function includesAny(query: string, terms: string[]) {
  return terms.some(term => query.includes(term))
}

function getPersonalStats(bills: Bill[], expenses: Expense[]): DashboardStat[] {
  const now = new Date()
  const weekFromNow = addDays(now, 7)
  const monthStart = startOfMonth(now)
  const monthEnd = endOfMonth(now)

  const unpaidBills = bills.filter(
    bill => bill.status !== BillStatus.paid && bill.status !== BillStatus.cancelled
  )
  const dueThisWeek = unpaidBills.filter((bill) => {
    const dueDate = parseISO(bill.due_date)
    return !isBefore(dueDate, now) && !isAfter(dueDate, weekFromNow)
  })
  const paidThisMonth = bills.filter((bill) => {
    if (bill.status !== BillStatus.paid || !bill.paid_at) return false
    const paidAt = parseISO(bill.paid_at)
    return !isBefore(paidAt, monthStart) && !isAfter(paidAt, monthEnd)
  })
  const expensesThisMonth = expenses.filter((expense) => {
    const expenseDate = parseISO(expense.expense_date)
    return !isBefore(expenseDate, monthStart) && !isAfter(expenseDate, monthEnd)
  })

  return [
    {
      title: 'Upcoming Bills',
      value: unpaidBills.length.toString(),
      change: `${dueThisWeek.length} due this week`,
      trend: dueThisWeek.length > 0 ? 'up' : 'down',
      icon: CalendarClock,
    },
    {
      title: 'Bills Due',
      value: formatCurrency(unpaidBills.reduce((sum, bill) => sum + bill.amount, 0)),
      change: `${unpaidBills.length} unpaid`,
      trend: unpaidBills.length > 0 ? 'up' : 'down',
      icon: CreditCard,
    },
    {
      title: 'Payments Made',
      value: paidThisMonth.length.toString(),
      change: `${formatCurrency(paidThisMonth.reduce((sum, bill) => sum + bill.amount, 0))} this month`,
      trend: 'down',
      icon: DollarSign,
    },
    {
      title: 'Monthly Spending',
      value: formatCurrency(expensesThisMonth.reduce((sum, expense) => sum + expense.amount, 0)),
      change: `${expensesThisMonth.length} expenses`,
      trend: expensesThisMonth.length > 0 ? 'up' : 'down',
      icon: Receipt,
    },
  ]
}

function getWorkStats(accountType: AccountType, data: WorkDashboardData): DashboardStat[] {
  const invoiceMoney = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: data.invoices[0]?.currency ?? 'USD' }).format(amount)
  const now = new Date()
  const monthStart = startOfMonth(now)
  const monthEnd = endOfMonth(now)

  const paymentsThisMonth = data.invoices.flatMap(invoice => invoice.payments ?? []).filter(payment => {
    if (payment.reversal) return false
    const paidAt = parseISO(payment.paid_on)
    return !isBefore(paidAt, monthStart) && !isAfter(paidAt, monthEnd)
  })
  const openInvoices = data.invoices.filter((invoice) =>
    invoice.status === InvoiceStatus.sent || invoice.status === InvoiceStatus.overdue
  )
  const expensesThisMonth = data.expenses.filter((expense) => {
    const expenseDate = parseISO(expense.expense_date)
    return !isBefore(expenseDate, monthStart) && !isAfter(expenseDate, monthEnd)
  })
  const openVendorBills = data.vendorBills.filter(
    bill => bill.status !== BillStatus.paid && bill.status !== BillStatus.cancelled
  )
  const timeEntriesThisMonth = data.timeEntries.filter((entry) => {
    const startedAt = parseISO(entry.start_at)
    return !isBefore(startedAt, monthStart) && !isAfter(startedAt, monthEnd)
  })
  const totalMinutes = timeEntriesThisMonth.reduce((sum, entry) => {
    if (typeof entry.duration_minutes === 'number') return sum + entry.duration_minutes
    if (entry.end_at) {
      const start = parseISO(entry.start_at)
      const end = parseISO(entry.end_at)
      return sum + Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
    }
    return sum
  }, 0)
  const revenueTotal = paymentsThisMonth.reduce((sum, payment) => sum + payment.amount, 0)
  const openInvoiceTotal = openInvoices.reduce((sum, invoice) => sum + (invoice.balance_due ?? invoice.total), 0)
  const expenseTotal = expensesThisMonth.reduce((sum, expense) => sum + expense.amount, 0)
  const vendorBillTotal = openVendorBills.reduce((sum, bill) => sum + bill.total, 0)

  if (accountType === AccountType.freelancer) {
    return [
      {
        title: 'Billable Hours',
        value: formatHours(totalMinutes),
        change: `${timeEntriesThisMonth.length} entries this month`,
        trend: totalMinutes > 0 ? 'up' : 'down',
        icon: Clock,
      },
      {
        title: 'Cash received MTD',
        value: invoiceMoney(revenueTotal),
        change: `${paymentsThisMonth.length} recorded payments`,
        trend: revenueTotal > 0 ? 'up' : 'down',
        icon: DollarSign,
      },
      {
        title: 'Outstanding',
        value: invoiceMoney(openInvoiceTotal),
        change: `${openInvoices.length} open invoices`,
        trend: openInvoices.length > 0 ? 'up' : 'down',
        icon: FileText,
      },
      {
        title: 'Expenses MTD',
        value: formatCurrency(expenseTotal),
        change: `${expensesThisMonth.length} expense records`,
        trend: expenseTotal > 0 ? 'up' : 'down',
        icon: Receipt,
      },
    ]
  }

  return [
    {
      title: 'Cash received MTD',
      value: invoiceMoney(revenueTotal),
      change: `${paymentsThisMonth.length} recorded payments`,
      trend: revenueTotal > 0 ? 'up' : 'down',
      icon: DollarSign,
    },
    {
      title: 'Open Invoices',
      value: invoiceMoney(openInvoiceTotal),
      change: `${openInvoices.length} sent or overdue`,
      trend: openInvoices.length > 0 ? 'up' : 'down',
      icon: FileText,
    },
    {
      title: 'Vendor Bills Due',
      value: formatCurrency(vendorBillTotal),
      change: `${openVendorBills.length} unpaid bills`,
      trend: openVendorBills.length > 0 ? 'up' : 'down',
      icon: CreditCard,
    },
    {
      title: 'Team Hours',
      value: formatHours(totalMinutes),
      change: `${timeEntriesThisMonth.length} entries this month`,
      trend: totalMinutes > 0 ? 'up' : 'down',
      icon: Clock,
    },
  ]
}

function getRecentPersonalActivity(bills: Bill[], expenses: Expense[]): RecentActivity[] {
  const billActivities = bills.map((bill) => ({
    id: `bill-${bill.id}`,
    message: `${bill.status === BillStatus.paid ? 'Paid' : 'Added'} bill: ${bill.name}`,
    time: formatDistanceToNow(parseISO(bill.updated_at || bill.created_at), { addSuffix: true }),
    status: bill.status === BillStatus.overdue ? 'warning' as const : 'success' as const,
    date: parseISO(bill.updated_at || bill.created_at),
  }))

  const expenseActivities = expenses.map((expense) => ({
    id: `expense-${expense.id}`,
    message: `Recorded expense: ${expense.merchant || expense.description || 'Expense'}`,
    time: formatDistanceToNow(parseISO(expense.updated_at || expense.created_at), { addSuffix: true }),
    status: expense.status === ExpenseStatus.rejected ? 'warning' as const : 'success' as const,
    date: parseISO(expense.updated_at || expense.created_at),
  }))

  return [...billActivities, ...expenseActivities]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 4)
    .map(({ date: _date, ...activity }) => activity)
}

function getPersonalMonthlySummary(bills: Bill[], expenses: Expense[]): MonthlySummary {
  const now = new Date()
  const monthStart = startOfMonth(now)
  const monthEnd = endOfMonth(now)
  const expensesThisMonth = expenses.filter((expense) => {
    const expenseDate = parseISO(expense.expense_date)
    return !isBefore(expenseDate, monthStart) && !isAfter(expenseDate, monthEnd)
  })
  const paidBillsThisMonth = bills.filter((bill) => {
    if (bill.status !== BillStatus.paid || !bill.paid_at) return false
    const paidAt = parseISO(bill.paid_at)
    return !isBefore(paidAt, monthStart) && !isAfter(paidAt, monthEnd)
  })
  const unpaidBills = bills.filter(
    bill => bill.status !== BillStatus.paid && bill.status !== BillStatus.cancelled
  )
  const overdueBills = unpaidBills.filter(bill => differenceInCalendarDays(parseISO(bill.due_date), now) < 0)
  const expenseTotal = expensesThisMonth.reduce((sum, expense) => sum + expense.amount, 0)
  const paidBillTotal = paidBillsThisMonth.reduce((sum, bill) => sum + bill.amount, 0)
  const unpaidBillTotal = unpaidBills.reduce((sum, bill) => sum + bill.amount, 0)
  const categoryTotals = expensesThisMonth.reduce<Record<string, number>>((totals, expense) => {
    const category = expense.category || 'Uncategorized'
    totals[category] = (totals[category] || 0) + expense.amount
    return totals
  }, {})
  const topCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0]

  if (expensesThisMonth.length === 0 && paidBillsThisMonth.length === 0 && unpaidBills.length === 0) {
    return {
      headline: 'No money movement tracked yet this month.',
      body: 'Add bills and expenses as they happen and Amountly will turn them into a month-end summary.',
      highlights: [
        'Start with one recent expense.',
        'Add upcoming bills before their due dates.',
        'Use Tax Prep once records start building up.',
      ],
    }
  }

  return {
    headline: overdueBills.length > 0
      ? `${overdueBills.length} overdue ${overdueBills.length === 1 ? 'bill needs' : 'bills need'} attention.`
      : unpaidBills.length > 0
        ? `${formatCurrency(unpaidBillTotal)} in bills is still open.`
        : 'Tracked bills are settled for now.',
    body: `This month includes ${formatCurrency(expenseTotal)} in expenses and ${formatCurrency(paidBillTotal)} in paid bills.`,
    highlights: [
      topCategory ? `${topCategory[0]} is the largest expense category at ${formatCurrency(topCategory[1])}.` : 'No expense categories recorded yet.',
      unpaidBills.length ? `${unpaidBills.length} unpaid ${unpaidBills.length === 1 ? 'bill remains' : 'bills remain'} on the list.` : 'No unpaid bills are currently tracked.',
      overdueBills.length ? 'Handle overdue bills before closing the month.' : 'Keep recording new spending so reports stay useful.',
    ],
  }
}

function getSampleMonthlySummary(accountType: AccountType): MonthlySummary {
  if (accountType === AccountType.freelancer) {
    return {
      headline: 'This month is invoice-first.',
      body: 'Tracked work, open invoices, and tax set-asides should stay connected so cash does not surprise you.',
      highlights: [
        'Convert recent billable work into draft invoices.',
        'Follow up on sent or overdue invoices.',
        'Review expenses before estimating quarterly taxes.',
      ],
    }
  }

  return {
    headline: 'This month needs a cashflow pass.',
    body: 'Review receivables, upcoming bills, and expense capture before moving into deeper accounting work.',
    highlights: [
      'Collect or remind on open invoices.',
      'Capture missing vendor bills and expenses.',
      'Use Tax Prep once income and expenses look complete.',
    ],
  }
}

function getPersonalNextSteps(bills: Bill[], expenses: Expense[]): AiNextStep[] {
  const now = new Date()
  const unpaidBills = bills.filter(
    bill => bill.status !== BillStatus.paid && bill.status !== BillStatus.cancelled
  )
  const overdueBills = unpaidBills.filter(bill => differenceInCalendarDays(parseISO(bill.due_date), now) < 0)
  const billsDueThisWeek = unpaidBills.filter((bill) => {
    const dueDate = parseISO(bill.due_date)
    return !isBefore(dueDate, now) && !isAfter(dueDate, addDays(now, 7))
  })
  const uncategorizedExpenses = expenses.filter((expense) => !expense.category)
  const submittedExpenses = expenses.filter((expense) => expense.status === ExpenseStatus.submitted)
  const nextSteps: AiNextStep[] = []

  if (overdueBills.length > 0) {
    nextSteps.push({
      id: 'overdue-bills',
      title: `${overdueBills.length} overdue ${overdueBills.length === 1 ? 'bill' : 'bills'}`,
      detail: `Review ${formatCurrency(overdueBills.reduce((sum, bill) => sum + bill.amount, 0))} in overdue payments.`,
      href: '/bills',
      priority: 'high',
    })
  }

  if (billsDueThisWeek.length > 0) {
    nextSteps.push({
      id: 'bills-due-this-week',
      title: `${billsDueThisWeek.length} ${billsDueThisWeek.length === 1 ? 'bill is' : 'bills are'} due this week`,
      detail: 'Pay or mark them paid to keep the dashboard current.',
      href: '/bills',
      priority: 'medium',
    })
  }

  if (uncategorizedExpenses.length > 0) {
    nextSteps.push({
      id: 'categorize-expenses',
      title: `${uncategorizedExpenses.length} expenses need categories`,
      detail: 'Categorized expenses make reports and tax exports cleaner.',
      href: '/expenses',
      priority: 'medium',
    })
  }

  if (submittedExpenses.length > 0) {
    nextSteps.push({
      id: 'submitted-expenses',
      title: `${submittedExpenses.length} expenses are waiting`,
      detail: 'Review pending expenses before month end.',
      href: '/expenses',
      priority: 'low',
    })
  }

  if (nextSteps.length === 0) {
    nextSteps.push({
      id: 'clean-month',
      title: 'Your records look current',
      detail: 'Add new bills or expenses as they come in and Amountly will surface what needs attention.',
      href: '/expenses',
      priority: 'low',
    })
  }

  return nextSteps.slice(0, 3)
}

function getSampleNextSteps(accountType: AccountType): AiNextStep[] {
  if (accountType === AccountType.freelancer) {
    return [
      {
        id: 'draft-invoices',
        title: 'Turn tracked work into invoices',
        detail: 'Review recent billable hours and draft invoices for active clients.',
        href: '/invoices',
        priority: 'high',
      },
      {
        id: 'expense-review',
        title: 'Check this month\'s expenses',
        detail: 'Categorize spending before tax prep gets noisy.',
        href: '/expenses',
        priority: 'medium',
      },
      {
        id: 'tax-prep',
        title: 'Estimate your quarterly tax set-aside',
        detail: 'Use income and expense totals to keep cash reserved.',
        href: '/tax',
        priority: 'low',
      },
    ]
  }

  return [
    {
      id: 'cashflow-review',
      title: 'Review open invoices and bills',
      detail: 'Keep receivables and upcoming payments visible in one routine.',
      href: '/dashboard',
      priority: 'high',
    },
    {
      id: 'client-follow-up',
      title: 'Follow up on unpaid invoices',
      detail: 'A quick payment reminder can protect this month\'s cashflow.',
      href: '/invoices',
      priority: 'medium',
    },
    {
      id: 'tax-ready',
      title: 'Prepare tax-ready records',
      detail: 'Make sure income and expenses are categorized before export.',
      href: '/tax',
      priority: 'low',
    },
  ]
}

function getPriorityVariant(priority: AiNextStep['priority']): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (priority) {
    case 'high':
      return 'destructive'
    case 'medium':
      return 'secondary'
    default:
      return 'outline'
  }
}

function getPersonalFinancialSearchResults(query: string, bills: Bill[], expenses: Expense[]): FinancialSearchResult[] {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return []

  const now = new Date()
  const monthStart = startOfMonth(now)
  const yearStart = new Date(now.getFullYear(), 0, 1)
  const unpaidBills = bills.filter(
    bill => bill.status !== BillStatus.paid && bill.status !== BillStatus.cancelled
  )
  const overdueBills = unpaidBills.filter(bill => differenceInCalendarDays(parseISO(bill.due_date), now) < 0)
  const billsDueSoon = unpaidBills.filter((bill) => {
    const dueDate = parseISO(bill.due_date)
    return !isBefore(dueDate, now) && !isAfter(dueDate, addDays(now, 7))
  })
  const expensesThisMonth = expenses.filter((expense) => {
    const expenseDate = parseISO(expense.expense_date)
    return !isBefore(expenseDate, monthStart)
  })
  const expensesThisYear = expenses.filter((expense) => {
    const expenseDate = parseISO(expense.expense_date)
    return !isBefore(expenseDate, yearStart)
  })
  const uncategorizedExpenses = expenses.filter(
    expense => !expense.category || expense.category === ExpenseCategory.other
  )
  const results: FinancialSearchResult[] = []

  if (includesAny(normalizedQuery, ['overdue', 'late', 'past due'])) {
    results.push({
      id: 'search-overdue-bills',
      title: overdueBills.length
        ? `${overdueBills.length} overdue ${overdueBills.length === 1 ? 'bill' : 'bills'} found`
        : 'No overdue bills found',
      detail: overdueBills.length
        ? `${formatCurrency(overdueBills.reduce((sum, bill) => sum + bill.amount, 0))} needs review in Bills.`
        : 'Tracked unpaid bills are not past due right now.',
      href: '/bills',
      label: 'Open Bills',
      priority: overdueBills.length ? 'high' : 'low',
    })
  }

  if (includesAny(normalizedQuery, ['bill', 'bills', 'due', 'payment', 'pay'])) {
    results.push({
      id: 'search-upcoming-bills',
      title: billsDueSoon.length
        ? `${billsDueSoon.length} ${billsDueSoon.length === 1 ? 'bill is' : 'bills are'} due soon`
        : `${unpaidBills.length} unpaid ${unpaidBills.length === 1 ? 'bill' : 'bills'}`,
      detail: unpaidBills.length
        ? `${formatCurrency(unpaidBills.reduce((sum, bill) => sum + bill.amount, 0))} is still open.`
        : 'There are no unpaid bills in the current dashboard data.',
      href: '/bills',
      label: 'Review Bills',
      priority: billsDueSoon.length ? 'medium' : 'low',
    })
  }

  if (includesAny(normalizedQuery, ['expense', 'expenses', 'spending', 'receipt', 'receipts', 'category', 'categorize', 'uncategorized'])) {
    results.push({
      id: 'search-expenses',
      title: uncategorizedExpenses.length
        ? `${uncategorizedExpenses.length} expenses may need cleanup`
        : `${expensesThisMonth.length} expenses tracked this month`,
      detail: uncategorizedExpenses.length
        ? 'Review expenses marked Other before reports or tax export.'
        : `${formatCurrency(expensesThisMonth.reduce((sum, expense) => sum + expense.amount, 0))} is recorded for this month.`,
      href: '/expenses',
      label: 'Open Expenses',
      priority: uncategorizedExpenses.length ? 'medium' : 'low',
    })
  }

  if (includesAny(normalizedQuery, ['tax', 'deduction', 'deductions', 'export', 'quarterly', '1099'])) {
    results.push({
      id: 'search-tax',
      title: `${expensesThisYear.length} expense records can feed Tax Prep`,
      detail: expensesThisYear.length
        ? `${formatCurrency(expensesThisYear.reduce((sum, expense) => sum + expense.amount, 0))} in current-year expenses is available for review.`
        : 'Add expenses first, then Tax Prep can help organize records.',
      href: '/tax',
      label: 'Open Tax Prep',
      priority: expensesThisYear.length ? 'medium' : 'low',
    })
  }

  if (normalizedQuery.length > 2) {
    const matchedExpenses = expenses.filter((expense) => {
      const searchable = [
        expense.merchant,
        expense.description,
        expense.notes,
        expense.category ? expenseCategoryLabels[expense.category] : undefined,
      ].filter(Boolean).join(' ').toLowerCase()
      return searchable.includes(normalizedQuery)
    })
    const matchedBills = bills.filter((bill) => {
      const searchable = [bill.name, bill.payee, bill.notes, bill.category].filter(Boolean).join(' ').toLowerCase()
      return searchable.includes(normalizedQuery)
    })

    if (matchedExpenses.length > 0) {
      results.push({
        id: 'search-matched-expenses',
        title: `${matchedExpenses.length} matching ${matchedExpenses.length === 1 ? 'expense' : 'expenses'}`,
        detail: `Matches total ${formatCurrency(matchedExpenses.reduce((sum, expense) => sum + expense.amount, 0))}.`,
        href: '/expenses',
        label: 'View Matches',
        priority: 'low',
      })
    }

    if (matchedBills.length > 0) {
      results.push({
        id: 'search-matched-bills',
        title: `${matchedBills.length} matching ${matchedBills.length === 1 ? 'bill' : 'bills'}`,
        detail: `Matches total ${formatCurrency(matchedBills.reduce((sum, bill) => sum + bill.amount, 0))}.`,
        href: '/bills',
        label: 'View Matches',
        priority: 'low',
      })
    }
  }

  if (results.length === 0) {
    results.push({
      id: 'search-fallback',
      title: 'No direct match yet',
      detail: 'Try overdue bills, tax expenses, receipts, or a merchant name from your records.',
      href: '/dashboard',
      label: 'Stay Here',
      priority: 'low',
    })
  }

  return results.slice(0, 4)
}

function getSampleFinancialSearchResults(query: string, accountType: AccountType): FinancialSearchResult[] {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return []

  const results: FinancialSearchResult[] = []
  const isFreelancer = accountType === AccountType.freelancer

  if (includesAny(normalizedQuery, ['invoice', 'invoices', 'paid', 'payment', 'client', 'customer', 'overdue'])) {
    results.push({
      id: 'sample-invoices',
      title: isFreelancer ? 'Invoice workflow is the best match' : 'Receivables need an invoice pass',
      detail: isFreelancer
        ? 'Review open invoices or draft invoices from tracked work.'
        : 'Open invoices, reminders, and payment follow-ups live together.',
      href: '/invoices',
      label: 'Open Invoices',
      priority: 'high',
    })
  }

  if (includesAny(normalizedQuery, ['expense', 'expenses', 'spending', 'receipt', 'receipts', 'category', 'categorize'])) {
    results.push({
      id: 'sample-expenses',
      title: 'Expense capture is the best match',
      detail: 'Use smart capture to turn spending into categorized records.',
      href: '/expenses',
      label: 'Open Expenses',
      priority: 'medium',
    })
  }

  if (includesAny(normalizedQuery, ['bill', 'bills', 'vendor', 'payable', 'due'])) {
    results.push({
      id: 'sample-bills',
      title: 'Bills and vendor payments are the best match',
      detail: 'Review upcoming bills, reminders, and payables before close.',
      href: '/bills',
      label: 'Open Bills',
      priority: 'medium',
    })
  }

  if (includesAny(normalizedQuery, ['time', 'hours', 'project', 'work'])) {
    results.push({
      id: 'sample-time',
      title: 'Tracked work is the best match',
      detail: 'Review billable time, then turn complete work into invoices.',
      href: '/time-entries',
      label: 'Open Time',
      priority: 'medium',
    })
  }

  if (includesAny(normalizedQuery, ['tax', 'deduction', 'deductions', 'export', 'quarterly', '1099'])) {
    results.push({
      id: 'sample-tax',
      title: 'Tax Prep is the best match',
      detail: 'Review categorized income and expenses before exporting records.',
      href: '/tax',
      label: 'Open Tax Prep',
      priority: 'medium',
    })
  }

  if (includesAny(normalizedQuery, ['close', 'month', 'monthly', 'summary', 'report'])) {
    results.push({
      id: 'sample-close',
      title: 'Monthly close is the best match',
      detail: 'Use the dashboard checklist to review invoices, spending, and tax readiness.',
      href: '/dashboard',
      label: 'Review Dashboard',
      priority: 'low',
    })
  }

  if (results.length === 0) {
    results.push({
      id: 'sample-fallback',
      title: 'Try a workflow phrase',
      detail: 'Search for invoices, bills, expenses, time, tax, or monthly close.',
      href: '/dashboard',
      label: 'Stay Here',
      priority: 'low',
    })
  }

  return results.slice(0, 4)
}

function getMonthlyCloseChecklist(accountType: AccountType, bills: Bill[], expenses: Expense[]): CloseChecklistItem[] {
  if (accountType === AccountType.personal) {
    const unpaidBills = bills.filter(
      bill => bill.status !== BillStatus.paid && bill.status !== BillStatus.cancelled
    )
    const uncategorizedExpenses = expenses.filter((expense) => !expense.category)
    const monthStart = startOfMonth(new Date())
    const expensesThisMonth = expenses.filter((expense) => {
      const expenseDate = parseISO(expense.expense_date)
      return !isBefore(expenseDate, monthStart)
    })

    return [
      {
        id: 'personal-bills',
        label: 'Review unpaid bills',
        detail: unpaidBills.length ? `${unpaidBills.length} bills still need attention.` : 'All tracked bills are settled.',
        href: '/bills',
        done: unpaidBills.length === 0,
      },
      {
        id: 'personal-expenses',
        label: 'Categorize spending',
        detail: uncategorizedExpenses.length ? `${uncategorizedExpenses.length} expenses need categories.` : 'Expenses are ready for reporting.',
        href: '/expenses',
        done: uncategorizedExpenses.length === 0,
      },
      {
        id: 'personal-tax',
        label: 'Prepare tax records',
        detail: expensesThisMonth.length ? `${expensesThisMonth.length} expenses can feed tax prep.` : 'Add this month\'s expenses before export.',
        href: '/tax',
        done: expensesThisMonth.length > 0,
      },
    ]
  }

  return [
    {
      id: 'business-invoices',
      label: 'Review open invoices',
      detail: 'Draft reminders for sent or overdue invoices.',
      href: '/invoices',
      done: false,
    },
    {
      id: 'business-expenses',
      label: 'Capture missing expenses',
      detail: 'Use smart capture to keep spending categorized.',
      href: '/expenses',
      done: false,
    },
    {
      id: 'business-tax',
      label: 'Check tax prep',
      detail: 'Review income and expenses before exporting records.',
      href: '/tax',
      done: false,
    },
  ]
}

export default function DashboardPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { hasCapability } = useAppState()
  const [personalBills, setPersonalBills] = useState<Bill[]>([])
  const [personalExpenses, setPersonalExpenses] = useState<Expense[]>([])
  const [workDashboardData, setWorkDashboardData] = useState<WorkDashboardData>({
    invoices: [],
    expenses: [],
    timeEntries: [],
    vendorBills: [],
  })
  const [personalDashboardError, setPersonalDashboardError] = useState<string | null>(null)
  const [closeGuideOpen, setCloseGuideOpen] = useState(false)
  const [activeCloseStepId, setActiveCloseStepId] = useState<string | null>(null)
  const [financialSearchQuery, setFinancialSearchQuery] = useState('')
  const [dashboardAiInsights, setDashboardAiInsights] = useState<{
    nextSteps: AiNextStep[]
    monthlySummary: MonthlySummary
    searchResults: FinancialSearchResult[]
  } | null>(null)

  const accountType = user?.account_type || AccountType.personal

  useEffect(() => {
    if (accountType !== AccountType.personal) return

    let isMounted = true

    const loadPersonalDashboard = async () => {
      try {
        const [bills, expenses] = await Promise.all([getBills(), getExpenses()])
        if (!isMounted) return
        setPersonalBills(bills)
        setPersonalExpenses(expenses)
        setPersonalDashboardError(null)
      } catch (error) {
        if (!isMounted) return
        setPersonalDashboardError(error instanceof Error ? error.message : 'Failed to load dashboard data')
      }
    }

    loadPersonalDashboard()

    return () => {
      isMounted = false
    }
  }, [accountType])

  useEffect(() => {
    if (accountType === AccountType.personal) return

    let isMounted = true

    const loadWorkDashboard = async () => {
      const [invoicesResult, expensesResult, timeEntriesResult, vendorBillsResult] = await Promise.allSettled([
        getInvoices({
          organizationId: user?.organization_id ?? null,
          userId: user?.id,
        }),
        getExpenses(),
        getTimeEntries(),
        getVendorBills(),
      ])

      if (!isMounted) return

      setWorkDashboardData({
        invoices: invoicesResult.status === 'fulfilled' ? invoicesResult.value : [],
        expenses: expensesResult.status === 'fulfilled' ? expensesResult.value : [],
        timeEntries: timeEntriesResult.status === 'fulfilled' ? timeEntriesResult.value : [],
        vendorBills: vendorBillsResult.status === 'fulfilled' ? vendorBillsResult.value : [],
      })

      const failedLoads = [
        invoicesResult,
        expensesResult,
        timeEntriesResult,
        vendorBillsResult,
      ].filter((result) => result.status === 'rejected')

      setPersonalDashboardError(
        failedLoads.length > 0
          ? 'Some dashboard KPI data could not be loaded.'
          : null
      )
    }

    loadWorkDashboard()

    return () => {
      isMounted = false
    }
  }, [accountType, user?.id, user?.organization_id])

  useEffect(() => {
    const handleDashboardSearch = (event: Event) => {
      const query =
        event instanceof CustomEvent && typeof event.detail === 'string'
          ? event.detail
          : ''
      setFinancialSearchQuery(query)
    }

    window.addEventListener('amountly-dashboard-search', handleDashboardSearch)
    return () => {
      window.removeEventListener('amountly-dashboard-search', handleDashboardSearch)
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    const loadAiInsights = async () => {
      try {
        const insights = await getDashboardAiInsights({
          accountType,
          searchQuery: financialSearchQuery,
          bills: personalBills,
          expenses: personalExpenses,
          workData: workDashboardData,
          candidateHrefs: ['/dashboard', '/bills', '/expenses', '/invoices', '/time-entries', '/tax'],
        })

        if (isMounted) setDashboardAiInsights(insights)
      } catch (error) {
        if (isMounted) setDashboardAiInsights(null)
        // Optional AI may be unavailable; deterministic figures remain usable.
      }
    }

    // Avoid consuming a paid request for every keystroke or intermediate data load.
    const timer = window.setTimeout(loadAiInsights, 750)

    return () => {
      window.clearTimeout(timer)
      isMounted = false
    }
  }, [accountType, financialSearchQuery, personalBills, personalExpenses, workDashboardData])

  const getStatsForAccountType = (): DashboardStat[] => {
    switch (accountType) {
      case AccountType.personal:
        return getPersonalStats(personalBills, personalExpenses)
      case AccountType.freelancer:
      case AccountType.business:
        return getWorkStats(accountType, workDashboardData)
      default:
        return getPersonalStats(personalBills, personalExpenses)
    }
  }

  const multipleInvoiceCurrencies = new Set(workDashboardData.invoices.map(invoice => invoice.currency)).size > 1
  const stats = getStatsForAccountType().map(stat => multipleInvoiceCurrencies && (stat.title === 'Cash received MTD' || stat.title === 'Open Invoices' || stat.title === 'Outstanding')
    ? { ...stat, value: 'Multiple currencies', change: 'Review balances on each invoice' } : stat)
  const quickActions = getQuickActions(accountType)

  const recentActivities =
    accountType === AccountType.personal
      ? getRecentPersonalActivity(personalBills, personalExpenses)
      : []
  const localNextSteps =
    accountType === AccountType.personal
      ? getPersonalNextSteps(personalBills, personalExpenses)
      : getSampleNextSteps(accountType)
  const monthlyCloseChecklist = getMonthlyCloseChecklist(accountType, personalBills, personalExpenses)
  const localMonthlySummary =
    accountType === AccountType.personal
      ? getPersonalMonthlySummary(personalBills, personalExpenses)
      : getSampleMonthlySummary(accountType)
  const localFinancialSearchResults =
    accountType === AccountType.personal
      ? getPersonalFinancialSearchResults(financialSearchQuery, personalBills, personalExpenses)
      : getSampleFinancialSearchResults(financialSearchQuery, accountType)
  const aiNextSteps = dashboardAiInsights?.nextSteps.length ? dashboardAiInsights.nextSteps : localNextSteps
  const monthlySummary = dashboardAiInsights?.monthlySummary ?? localMonthlySummary
  const financialSearchResults =
    financialSearchQuery.trim() && dashboardAiInsights
      ? dashboardAiInsights.searchResults
      : localFinancialSearchResults
  const completedCloseSteps = monthlyCloseChecklist.filter(item => item.done).length
  const monthlyCloseProgress = Math.round((completedCloseSteps / monthlyCloseChecklist.length) * 100)
  const activeCloseStep =
    monthlyCloseChecklist.find(item => item.id === activeCloseStepId) ??
    monthlyCloseChecklist.find(item => !item.done) ??
    monthlyCloseChecklist[0]

  const unpaidBills = personalBills.filter(
    bill => bill.status !== BillStatus.paid && bill.status !== BillStatus.cancelled
  )
  const overdueBills = unpaidBills.filter(bill => differenceInCalendarDays(parseISO(bill.due_date), new Date()) < 0)
  const billsDueThisWeek = unpaidBills.filter((bill) => {
    const dueDate = parseISO(bill.due_date)
    return !isBefore(dueDate, new Date()) && !isAfter(dueDate, addDays(new Date(), 7))
  })
  const pendingExpenses = personalExpenses.filter(expense => expense.status === ExpenseStatus.submitted)
  const openWorkInvoices = workDashboardData.invoices.filter((invoice) =>
    invoice.status === InvoiceStatus.sent || invoice.status === InvoiceStatus.overdue
  )
  const overdueWorkInvoices = workDashboardData.invoices.filter(invoice => invoice.status === InvoiceStatus.overdue)
  const draftWorkInvoices = workDashboardData.invoices.filter(invoice => invoice.status === InvoiceStatus.draft)
  const pendingWorkExpenses = workDashboardData.expenses.filter(expense => expense.status === ExpenseStatus.submitted)
  const openWorkVendorBills = workDashboardData.vendorBills.filter(
    bill => bill.status !== BillStatus.paid && bill.status !== BillStatus.cancelled
  )

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'warning':
        return <AlertCircle className="w-4 h-4 text-yellow-500" />
      default:
        return <CheckCircle className="w-4 h-4 text-gray-500" />
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Money Overview</h1>
        <p className="text-muted-foreground">
          Welcome back, {user?.name?.split(' ')[0] || 'there'} — here are the financial items that need attention.
        </p>
      </div>

      <p className="text-sm text-muted-foreground">{format(new Date(), 'MMMM yyyy')} · Cash received includes recorded payments only.</p>
      {/* Stats */}
      {personalDashboardError && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">
            {personalDashboardError}
          </CardContent>
        </Card>
      )}

      {stats.length > 0 ? (
        <div className={`grid grid-cols-1 md:grid-cols-2 ${stats.length > 2 ? 'lg:grid-cols-4' : ''} gap-6`}>
          {stats.map((stat, index) => (
            <Card key={index}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                <stat.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  {stat.trend === 'up' ? (
                    <TrendingUp className="h-3 w-3 text-green-500" />
                  ) : (
                    <TrendingDown className="h-3 w-3 text-red-500" />
                  )}
                  {stat.change}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {accountType !== AccountType.personal && <Card><CardHeader><CardTitle>Needs attention</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => router.push('/invoices')}>{workDashboardData.invoices.filter(i => i.status === InvoiceStatus.overdue).length} overdue invoices</Button>
        <Button variant="outline" onClick={() => router.push('/invoices')}>{workDashboardData.invoices.filter(i => i.status === InvoiceStatus.draft).length} invoice drafts</Button>
        <Button variant="outline" onClick={() => router.push('/expenses')}>{workDashboardData.expenses.filter(e => e.status === ExpenseStatus.draft).length} expense drafts to review</Button>
      </CardContent></Card>}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {dashboardAiInsights ? 'AI suggestions' : 'Suggested next steps'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="text-sm font-semibold">{monthlySummary.headline}</p>
              <p className="mt-2 text-sm text-muted-foreground">{monthlySummary.body}</p>
            </div>
            <div className="space-y-2">
              {monthlySummary.highlights.map((highlight) => (
                <div key={highlight} className="flex items-start gap-2 text-sm">
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                  <span className="text-muted-foreground">{highlight}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Wand2 className="h-4 w-4 text-muted-foreground" />
              Next steps
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {aiNextSteps.map((step) => (
                <button
                  key={step.id}
                  onClick={() => router.push(step.href)}
                  className="rounded-lg border bg-background p-4 text-left transition-colors hover:bg-accent"
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <Badge variant={getPriorityVariant(step.priority)}>
                      {step.priority}
                    </Badge>
                    <Wand2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <h2 className="text-sm font-semibold">{step.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{step.detail}</p>
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {financialSearchQuery.trim() ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Search className="h-5 w-5" />
              Search Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              {financialSearchResults.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => router.push(result.href)}
                  className="rounded-lg border bg-background p-4 text-left transition-colors hover:bg-accent"
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <Badge variant={getPriorityVariant(result.priority)}>
                      {result.priority}
                    </Badge>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <h2 className="text-sm font-semibold">{result.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{result.detail}</p>
                  <span className="mt-3 inline-flex text-xs font-medium text-primary">
                    {result.label}
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {quickActions.map((action) => (
              <button
                key={action.id}
                onClick={() => router.push(action.href)}
                className={`p-4 rounded-lg border transition-all duration-200 hover:shadow-md text-left ${action.cardBg}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <action.icon className={`w-6 h-6 ${action.cardIconColor}`} />
                </div>
                <h3 className="font-medium mb-1">{action.label}</h3>
                <p className="text-sm opacity-80">{action.description}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity & Quick Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5" />
                  Monthly Close
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {completedCloseSteps}/{monthlyCloseChecklist.length} steps ready
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setActiveCloseStepId(activeCloseStep.id)
                  setCloseGuideOpen(true)
                }}
                className="shrink-0 gap-2"
              >
                Start close
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Progress value={monthlyCloseProgress} className="mb-4" />
            <div className="space-y-3">
              {monthlyCloseChecklist.map((item) => (
                <button
                  key={item.id}
                  onClick={() => router.push(item.href)}
                  className="flex w-full items-start gap-3 rounded-lg bg-muted/50 p-3 text-left transition-colors hover:bg-accent"
                >
                  {item.done ? (
                    <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                  ) : (
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{item.label}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{item.detail}</span>
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivities.length > 0 ? recentActivities.map((activity) => (
                <div key={activity.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                  {getStatusIcon(activity.status)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{activity.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">{activity.time}</p>
                  </div>
                </div>
              )) : (
                <p className="text-sm text-muted-foreground">No recent activity yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Stats</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {accountType === AccountType.personal && hasCapability(Capability.viewBills) && (
                <>
                  <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                    <span className="text-sm">Overdue Bills</span>
                    <Badge variant="destructive">
                      {overdueBills.length}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                    <span className="text-sm">Due This Week</span>
                    <Badge variant="secondary">
                      {billsDueThisWeek.length}
                    </Badge>
                  </div>
                </>
              )}
              {accountType === AccountType.personal && hasCapability(Capability.viewOwnExpenses) && (
                <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                  <span className="text-sm">Pending Expenses</span>
                  <Badge variant="secondary">
                    {pendingExpenses.length}
                  </Badge>
                </div>
              )}
              {accountType !== AccountType.personal && (
                <>
                  {hasCapability(Capability.viewInvoices) && (
                    <>
                      <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                        <span className="text-sm">Open Invoices</span>
                        <Badge variant="secondary">{openWorkInvoices.length}</Badge>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                        <span className="text-sm">Overdue Invoices</span>
                        <Badge variant="destructive">{overdueWorkInvoices.length}</Badge>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                        <span className="text-sm">Draft Invoices</span>
                        <Badge variant="outline">{draftWorkInvoices.length}</Badge>
                      </div>
                    </>
                  )}
                  {hasCapability(Capability.viewAccountsPayable) && (
                    <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                      <span className="text-sm">Vendor Bills Due</span>
                      <Badge variant="secondary">{openWorkVendorBills.length}</Badge>
                    </div>
                  )}
                  {hasCapability(Capability.viewOwnExpenses) && (
                    <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                      <span className="text-sm">Pending Expenses</span>
                      <Badge variant="secondary">{pendingWorkExpenses.length}</Badge>
                    </div>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={closeGuideOpen} onOpenChange={setCloseGuideOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Guided Monthly Close</DialogTitle>
            <DialogDescription>
              Work through the few checks that keep records clean before month end.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{completedCloseSteps}/{monthlyCloseChecklist.length} steps ready</span>
                <span className="text-muted-foreground">{monthlyCloseProgress}%</span>
              </div>
              <Progress value={monthlyCloseProgress} />
            </div>

            <div className="grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
              <div className="space-y-2">
                {monthlyCloseChecklist.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveCloseStepId(item.id)}
                    className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                      activeCloseStep.id === item.id ? 'border-primary bg-primary/5' : 'bg-muted/30 hover:bg-accent'
                    }`}
                  >
                    {item.done ? (
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                    ) : (
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{item.label}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{item.done ? 'Ready' : 'Needs review'}</span>
                    </span>
                  </button>
                ))}
              </div>

              <div className="rounded-lg border bg-background p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Badge variant={activeCloseStep.done ? 'default' : 'secondary'}>
                    {activeCloseStep.done ? 'Ready' : 'Review'}
                  </Badge>
                  <h2 className="text-sm font-semibold">{activeCloseStep.label}</h2>
                </div>
                <p className="text-sm text-muted-foreground">{activeCloseStep.detail}</p>
                <div className="mt-5 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                  Finish this step in its workspace, then return to the dashboard. Amountly will refresh the close status from your records.
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCloseGuideOpen(false)}>
              Close
            </Button>
            <Button
              type="button"
              onClick={() => router.push(activeCloseStep.href)}
              className="gap-2"
            >
              Open step
              <ArrowRight className="h-4 w-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
