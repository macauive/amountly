'use client'
import { escapeCsvValue } from '@/lib/csv'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useAppState } from '@/contexts/AppStateContext'
import { getExpenses } from '@/services/expenses.service'
import { getInvoices } from '@/services/invoices.service'
import {
  getTaxFilings,
  createTaxFiling,
  updateTaxFiling,
  deleteTaxFiling,
  markTaxFilingFiled,
  seedQuarterlyEstimates,
} from '@/services/tax.service'
import type { Expense, Invoice, TaxFiling } from '@/types/models'
import {
  AccountType,
  Capability,
  InvoiceStatus,
  TaxFilingStatus,
  taxFilingStatusLabels,
} from '@/types/enums'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Plus,
  Calculator,
  Loader2,
  Trash2,
  Pencil,
  CheckCircle,
  AlertCircle,
  Clock,
  FileText,
  Download,
  CalendarClock,
  Wand2,
  DollarSign,
  TrendingUp,
  Receipt,
} from 'lucide-react'
import { toast } from 'sonner'
import { format, parseISO, differenceInDays, isPast, isWithinInterval, addDays } from 'date-fns'
import { useRouter } from 'next/navigation'

// ─── Helpers ──────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear()

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function getStatusVariant(status: TaxFilingStatus): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case TaxFilingStatus.filed:
    case TaxFilingStatus.accepted: return 'default'
    case TaxFilingStatus.inProgress: return 'secondary'
    case TaxFilingStatus.rejected: return 'destructive'
    default: return 'outline'
  }
}

function getDueBadge(dueDate: string, status: TaxFilingStatus) {
  if (status === TaxFilingStatus.filed || status === TaxFilingStatus.accepted) return null
  const days = differenceInDays(parseISO(dueDate), new Date())
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, variant: 'destructive' as const }
  if (days <= 14) return { label: `${days}d left`, variant: 'secondary' as const }
  return null
}

// US Tax brackets 2025 (single filer, approximate)
function estimateFederalTax(income: number): number {
  if (income <= 0) return 0
  const brackets = [
    { limit: 11925, rate: 0.10 },
    { limit: 48475, rate: 0.12 },
    { limit: 103350, rate: 0.22 },
    { limit: 197300, rate: 0.24 },
    { limit: 250525, rate: 0.32 },
    { limit: 626350, rate: 0.35 },
    { limit: Infinity, rate: 0.37 },
  ]
  const standardDeduction = 14600
  const taxableIncome = Math.max(0, income - standardDeduction)
  let tax = 0
  let prev = 0
  for (const bracket of brackets) {
    const taxable = Math.min(taxableIncome, bracket.limit) - prev
    if (taxable <= 0) break
    tax += taxable * bracket.rate
    prev = bracket.limit
  }
  return tax
}

// Self-employment tax (15.3% up to SS wage base, 2.9% above)
function estimateSETax(netEarnings: number): number {
  if (netEarnings <= 0) return 0
  const ssWageBase = 168600
  const ssTax = Math.min(netEarnings, ssWageBase) * 0.124
  const medicareTax = netEarnings * 0.029
  return ssTax + medicareTax
}

const FORM_TYPES = [
  '1040-ES', '1040', '1099-NEC', '1099-MISC', 'W-2',
  '941', '940', 'W-3', 'Sales Tax Return', 'State Return', 'Other',
]

type TaxReadinessItem = {
  id: string
  label: string
  detail: string
  done: boolean
  badge: string
  tone: 'ready' | 'watch' | 'action'
}

type TaxPrepReminder = {
  id: string
  title: string
  detail: string
  href: string
  badge: string
  tone: 'action' | 'watch' | 'ready'
}

type TaxPacketRow = {
  record_type: string
  date: string
  name: string
  category: string
  status: string
  amount: number | string
  notes: string
}

// ─── Quarter Cards ────────────────────────────────────────────

interface QuarterInfo {
  label: string
  period: string
  dueDate: string
  filing?: TaxFiling
}

function getQuarters(year: number): QuarterInfo[] {
  return [
    { label: 'Q1', period: `Jan 1 – Mar 31, ${year}`, dueDate: `${year}-04-15` },
    { label: 'Q2', period: `Apr 1 – May 31, ${year}`, dueDate: `${year}-06-16` },
    { label: 'Q3', period: `Jun 1 – Aug 31, ${year}`, dueDate: `${year}-09-15` },
    { label: 'Q4', period: `Sep 1 – Dec 31, ${year}`, dueDate: `${year + 1}-01-15` },
  ]
}

function downloadTaxPacketCsv(rows: TaxPacketRow[], filename: string) {
  const headers: (keyof TaxPacketRow)[] = ['record_type', 'date', 'name', 'category', 'status', 'amount', 'notes']
  const csv = [
    headers.join(','),
    ...rows.map(row => headers.map(header => escapeCsvValue(row[header])).join(',')),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// ─── Main Page ────────────────────────────────────────────────

export default function TaxPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { hasCapability } = useAppState()

  const accountType = user?.account_type || AccountType.personal
  const canEstimate = hasCapability(Capability.generateTaxEstimates)
  const canExport = hasCapability(Capability.exportTaxDocuments)
  const canTrackSalesTax = hasCapability(Capability.trackSalesTax)

  const [filings, setFilings] = useState<TaxFiling[]>([])
  const [taxExpenses, setTaxExpenses] = useState<Expense[]>([])
  const [taxInvoices, setTaxInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)

  // Form state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedFiling, setSelectedFiling] = useState<TaxFiling | null>(null)
  const [saving, setSaving] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)

  const [formData, setFormData] = useState({
    name: '',
    form_type: '1040-ES',
    tax_period_start: `${CURRENT_YEAR}-01-01`,
    tax_period_end: `${CURRENT_YEAR}-12-31`,
    due_date: '',
    amount_due: '',
    amount_paid: '',
    notes: '',
  })

  // Tax estimator inputs
  const [grossIncome, setGrossIncome] = useState('')
  const [expenses, setExpenses] = useState('')

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      setError(null)
      const yearStart = `${CURRENT_YEAR}-01-01`
      const yearEnd = `${CURRENT_YEAR}-12-31`
      const [filingsData, expensesData, invoicesData] = await Promise.all([
        getTaxFilings(),
        getExpenses({ startDate: yearStart, endDate: yearEnd }),
        getInvoices({
          userId: user?.id,
          organizationId: user?.organization_id,
        }),
      ])
      setFilings(filingsData)
      setTaxExpenses(expensesData)
      setTaxInvoices(invoicesData)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load data'
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  // ─── Handlers ────────────────────────────────────────────────

  const openCreate = () => {
    setSelectedFiling(null)
    setFormData({
      name: '',
      form_type: '1040-ES',
      tax_period_start: `${CURRENT_YEAR}-01-01`,
      tax_period_end: `${CURRENT_YEAR}-12-31`,
      due_date: format(new Date(), 'yyyy-MM-dd'),
      amount_due: '',
      amount_paid: '',
      notes: '',
    })
    setDialogOpen(true)
  }

  const openEdit = (filing: TaxFiling) => {
    setSelectedFiling(filing)
    setFormData({
      name: filing.name,
      form_type: filing.form_type,
      tax_period_start: filing.tax_period_start,
      tax_period_end: filing.tax_period_end,
      due_date: filing.due_date,
      amount_due: filing.amount_due?.toString() || '',
      amount_paid: filing.amount_paid?.toString() || '',
      notes: filing.notes || '',
    })
    setDialogOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const input = {
        user_id: user?.id!,
        organization_id: user?.organization_id,
        name: formData.name,
        form_type: formData.form_type,
        tax_period_start: formData.tax_period_start,
        tax_period_end: formData.tax_period_end,
        due_date: formData.due_date,
        status: TaxFilingStatus.notStarted,
        amount_due: formData.amount_due ? parseFloat(formData.amount_due) : undefined,
        amount_paid: formData.amount_paid ? parseFloat(formData.amount_paid) : undefined,
        notes: formData.notes || undefined,
      }
      if (selectedFiling) {
        await updateTaxFiling(selectedFiling.id, input)
        toast.success('Filing updated')
      } else {
        await createTaxFiling(input)
        toast.success('Filing added')
      }
      setDialogOpen(false)
      loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedFiling) return
    try {
      await deleteTaxFiling(selectedFiling.id)
      toast.success('Filing deleted')
      setDeleteDialogOpen(false)
      loadData()
    } catch {
      toast.error('Failed to delete')
    }
  }

  const handleMarkFiled = async (filing: TaxFiling) => {
    try {
      await markTaxFilingFiled(filing.id)
      toast.success('Marked as filed')
      loadData()
    } catch {
      toast.error('Failed to update')
    }
  }

  const handleSeedQuarterly = async () => {
    if (!user) return
    setSeeding(true)
    try {
      await seedQuarterlyEstimates(user.id, CURRENT_YEAR)
      toast.success(`${CURRENT_YEAR} quarterly estimates added`)
      loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to seed')
    } finally {
      setSeeding(false)
    }
  }

  const handleDownloadTaxPacket = () => {
    if (taxPacketRows.length === 0) {
      toast.error('No tax records to export')
      return
    }

    downloadTaxPacketCsv(taxPacketRows, `amountly-tax-packet-${CURRENT_YEAR}.csv`)
    toast.success('Tax packet downloaded')
  }

  // ─── Computed ────────────────────────────────────────────────

  const quarters = getQuarters(CURRENT_YEAR)
  const quarterFilings = filings.filter(f => f.form_type === '1040-ES')

  // Match filings to quarters by due date
  const quartersWithFilings = quarters.map(q => ({
    ...q,
    filing: quarterFilings.find(f => f.due_date === q.dueDate),
  }))

  const hasQuarterlyFilings = quarterFilings.length > 0

  const overdueFiled = filings.filter(
    f => isPast(parseISO(f.due_date)) && f.status !== TaxFilingStatus.filed && f.status !== TaxFilingStatus.accepted
  )
  const dueThisMonth = filings.filter(
    f => isWithinInterval(parseISO(f.due_date), { start: new Date(), end: addDays(new Date(), 30) }) &&
      f.status !== TaxFilingStatus.filed && f.status !== TaxFilingStatus.accepted
  )

  // Tax estimator
  const netIncome = (parseFloat(grossIncome) || 0) - (parseFloat(expenses) || 0)
  const seTax = accountType !== AccountType.personal ? estimateSETax(netIncome * 0.9235) : 0
  const seDeduction = seTax / 2
  const adjustedIncome = netIncome - seDeduction
  const federalTax = estimateFederalTax(adjustedIncome)
  const totalTax = federalTax + seTax
  const quarterlyPayment = totalTax / 4
  const hasEstimatorInputs = grossIncome.trim() !== '' && expenses.trim() !== ''
  const uncategorizedTaxExpenses = taxExpenses.filter(expense => !expense.category)
  const recentTaxExpenses = taxExpenses.filter((expense) => {
    const expenseDate = parseISO(expense.expense_date)
    return isWithinInterval(expenseDate, { start: addDays(new Date(), -45), end: new Date() })
  })
  const taxIncomeInvoices = taxInvoices.filter(invoice => (
    invoice.status === InvoiceStatus.sent ||
    invoice.status === InvoiceStatus.paid ||
    invoice.status === InvoiceStatus.overdue
  ))
  const taxExpenseTotal = taxExpenses.reduce((sum, expense) => sum + expense.amount, 0)
  const taxIncomeTotal = taxIncomeInvoices.reduce((sum, invoice) => sum + invoice.total, 0)
  const exportWarnings = [
    ...(overdueFiled.length > 0 ? [`${overdueFiled.length} filing${overdueFiled.length === 1 ? '' : 's'} are overdue.`] : []),
    ...(uncategorizedTaxExpenses.length > 0 ? [`${uncategorizedTaxExpenses.length} expense${uncategorizedTaxExpenses.length === 1 ? '' : 's'} are missing categories.`] : []),
    ...(taxExpenses.length === 0 ? ['No expenses are included for this tax year.'] : []),
    ...(accountType !== AccountType.personal && taxIncomeInvoices.length === 0 ? ['No sent, paid, or overdue invoices are included as income.'] : []),
  ]
  const taxPacketRows: TaxPacketRow[] = [
    ...taxExpenses.map((expense) => ({
      record_type: 'expense',
      date: expense.expense_date,
      name: expense.merchant || expense.description || 'Expense',
      category: expense.category || 'Uncategorized',
      status: expense.status,
      amount: expense.amount,
      notes: expense.notes || '',
    })),
    ...taxIncomeInvoices.map((invoice) => ({
      record_type: 'invoice',
      date: invoice.issue_date,
      name: invoice.invoice_number,
      category: invoice.client?.name || 'Client income',
      status: invoice.status,
      amount: invoice.total,
      notes: invoice.notes || '',
    })),
    ...filings.map((filing) => ({
      record_type: 'filing',
      date: filing.due_date,
      name: filing.name,
      category: filing.form_type,
      status: filing.status,
      amount: filing.amount_due ?? '',
      notes: filing.notes || '',
    })),
  ]

  const taxReadinessItems: TaxReadinessItem[] = [
    {
      id: 'deadlines',
      label: 'Deadlines are under control',
      detail: overdueFiled.length > 0
        ? `${overdueFiled.length} filing${overdueFiled.length === 1 ? '' : 's'} need attention before export.`
        : dueThisMonth.length > 0
          ? `${dueThisMonth.length} deadline${dueThisMonth.length === 1 ? '' : 's'} coming up in the next 30 days.`
          : 'No overdue or near-term filings are currently tracked.',
      done: overdueFiled.length === 0 && dueThisMonth.length === 0,
      badge: overdueFiled.length > 0 ? 'Action' : dueThisMonth.length > 0 ? 'Soon' : 'Ready',
      tone: overdueFiled.length > 0 ? 'action' : dueThisMonth.length > 0 ? 'watch' : 'ready',
    },
    ...(accountType !== AccountType.personal ? [{
      id: 'quarterly',
      label: `${CURRENT_YEAR} quarterly estimates are set up`,
      detail: hasQuarterlyFilings
        ? `${quarterFilings.length} estimated tax filing${quarterFilings.length === 1 ? '' : 's'} tracked for this year.`
        : 'Add quarterly estimates so self-employed tax payments do not live in your head.',
      done: hasQuarterlyFilings,
      badge: hasQuarterlyFilings ? 'Ready' : 'Add quarters',
      tone: hasQuarterlyFilings ? 'ready' : 'action',
    } satisfies TaxReadinessItem] : []),
    ...(canEstimate ? [{
      id: 'estimator',
      label: 'Estimator has income and expense inputs',
      detail: hasEstimatorInputs
        ? `Estimated quarterly payment is ${formatCurrency(Math.max(0, quarterlyPayment))}.`
        : 'Enter annual income and deductible expenses to get a rough tax planning number.',
      done: hasEstimatorInputs,
      badge: hasEstimatorInputs ? 'Estimated' : 'Needs inputs',
      tone: hasEstimatorInputs ? 'ready' : 'watch',
    } satisfies TaxReadinessItem] : []),
    ...(canExport ? [{
      id: 'export',
      label: 'Tax packet is ready to review',
      detail: filings.length > 0
        ? 'Tracked filings can be reviewed before exporting tax records.'
        : 'Add at least one filing or deadline before preparing an export packet.',
      done: filings.length > 0 && overdueFiled.length === 0,
      badge: filings.length > 0 ? 'Review' : 'Start',
      tone: filings.length > 0 && overdueFiled.length === 0 ? 'ready' : 'watch',
    } satisfies TaxReadinessItem] : []),
  ]

  const taxPrepReminders: TaxPrepReminder[] = [
    ...(uncategorizedTaxExpenses.length > 0 ? [{
      id: 'categorize-expenses',
      title: `${uncategorizedTaxExpenses.length} expense${uncategorizedTaxExpenses.length === 1 ? '' : 's'} need categories`,
      detail: 'Categorize them before export so deductible spending does not turn into a cleanup project.',
      href: '/expenses',
      badge: 'Action',
      tone: 'action',
    } satisfies TaxPrepReminder] : []),
    ...(taxExpenses.length === 0 ? [{
      id: 'missing-expenses',
      title: 'No expense records found for this tax year',
      detail: 'Add spending as it happens so Tax Prep has something useful to summarize.',
      href: '/expenses',
      badge: 'Start',
      tone: 'watch',
    } satisfies TaxPrepReminder] : []),
    ...(taxExpenses.length > 0 && recentTaxExpenses.length === 0 ? [{
      id: 'stale-expenses',
      title: 'Expense records look stale',
      detail: 'No expenses have been added in the last 45 days. Capture recent spending before estimating taxes.',
      href: '/expenses',
      badge: 'Review',
      tone: 'watch',
    } satisfies TaxPrepReminder] : []),
    ...(accountType !== AccountType.personal && taxIncomeInvoices.length === 0 ? [{
      id: 'missing-income',
      title: 'No invoice income is ready for tax prep',
      detail: 'Send, mark paid, or review invoices so income does not stay disconnected from estimates.',
      href: '/invoices',
      badge: 'Review',
      tone: 'watch',
    } satisfies TaxPrepReminder] : []),
  ]

  const visibleTaxPrepReminders = taxPrepReminders.length > 0
    ? taxPrepReminders
    : [{
        id: 'tax-ready',
        title: 'Tax prep records look current',
        detail: 'Expenses, income records, and filing deadlines are ready for a closer review.',
        href: '/tax',
        badge: 'Ready',
        tone: 'ready',
      } satisfies TaxPrepReminder]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="text-center py-12">
            <Calculator className="w-12 h-12 mx-auto mb-4 text-destructive opacity-50" />
            <p className="text-destructive font-medium">Error loading tax data</p>
            <p className="text-sm text-muted-foreground mt-2">{error}</p>
            <Button onClick={loadData} className="mt-4">Try Again</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Tax</h1>
          <p className="text-muted-foreground">
            {CURRENT_YEAR} tax year · {accountType === AccountType.personal ? 'Personal' : accountType === AccountType.freelancer ? 'Self-employed' : 'Business'}
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="w-4 h-4" />
          Add Filing
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Filings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{filings.length}</div>
            <p className="text-xs text-muted-foreground">
              {filings.filter(f => f.status === TaxFilingStatus.filed || f.status === TaxFilingStatus.accepted).length} filed
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-destructive">Overdue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{overdueFiled.length}</div>
            <p className="text-xs text-muted-foreground">past due date</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Due Next 30 Days</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dueThisMonth.length}</div>
            <p className="text-xs text-muted-foreground">upcoming deadlines</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Amount Due</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(
                filings
                  .filter(f => f.status !== TaxFilingStatus.filed && f.status !== TaxFilingStatus.accepted)
                  .reduce((s, f) => s + (f.amount_due || 0), 0)
              )}
            </div>
            <p className="text-xs text-muted-foreground">unfiled</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Wand2 className="w-4 h-4" />
                Amountly Tax Readiness
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                A plain-English check before you estimate, pay, or export. Estimates are planning aids, not tax advice.
              </p>
            </div>
            <Badge variant="outline" className="shrink-0">
              {taxReadinessItems.filter(item => item.done).length}/{taxReadinessItems.length} ready
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {taxReadinessItems.map((item) => (
              <div
                key={item.id}
                className="flex gap-3 rounded-lg border bg-muted/30 p-4"
              >
                {item.done ? (
                  <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                ) : (
                  <AlertCircle className={`mt-0.5 h-5 w-5 shrink-0 ${item.tone === 'action' ? 'text-destructive' : 'text-orange-500'}`} />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{item.label}</p>
                    <Badge
                      variant={item.tone === 'action' ? 'destructive' : item.done ? 'default' : 'secondary'}
                      className="text-xs"
                    >
                      {item.badge}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="w-4 h-4" />
            Tax Prep Reminders
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Amountly checks for missing or stale records that can make tax prep harder later.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visibleTaxPrepReminders.map((reminder) => (
              <div key={reminder.id} className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{reminder.title}</p>
                    <Badge variant={reminder.tone === 'action' ? 'destructive' : reminder.tone === 'ready' ? 'default' : 'secondary'}>
                      {reminder.badge}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{reminder.detail}</p>
                </div>
                {reminder.href !== '/tax' && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => router.push(reminder.href)}
                    className="shrink-0"
                  >
                    Review
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {canExport && (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  Tax Export Packet
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Review the records Amountly will include before downloading a CSV for your tax workspace.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setExportDialogOpen(true)}
                className="shrink-0 gap-2"
              >
                <Download className="h-4 w-4" />
                Review export
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Expenses</p>
                <p className="text-xl font-semibold">{taxExpenses.length}</p>
                <p className="text-xs text-muted-foreground">{formatCurrency(taxExpenseTotal)}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Income records</p>
                <p className="text-xl font-semibold">{taxIncomeInvoices.length}</p>
                <p className="text-xs text-muted-foreground">{formatCurrency(taxIncomeTotal)}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Filings</p>
                <p className="text-xl font-semibold">{filings.length}</p>
                <p className="text-xs text-muted-foreground">{overdueFiled.length} overdue</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Readiness</p>
                <p className="text-xl font-semibold">{exportWarnings.length === 0 ? 'Ready' : `${exportWarnings.length} flags`}</p>
                <p className="text-xs text-muted-foreground">review before filing</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Tabs */}
      <Tabs defaultValue={accountType === AccountType.personal ? 'filings' : 'quarterly'}>
        <TabsList>
          {accountType !== AccountType.personal && (
            <TabsTrigger value="quarterly" className="gap-2">
              <CalendarClock className="w-4 h-4" />
              Quarterly Estimates
            </TabsTrigger>
          )}
          <TabsTrigger value="filings" className="gap-2">
            <FileText className="w-4 h-4" />
            Filings & Deadlines
          </TabsTrigger>
          {canEstimate && (
            <TabsTrigger value="estimator" className="gap-2">
              <Calculator className="w-4 h-4" />
              Tax Estimator
            </TabsTrigger>
          )}
          {canTrackSalesTax && (
            <TabsTrigger value="salestax" className="gap-2">
              <Receipt className="w-4 h-4" />
              Sales Tax
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── Quarterly Estimates ── */}
        {accountType !== AccountType.personal && (
          <TabsContent value="quarterly" className="mt-4 space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="font-semibold">{CURRENT_YEAR} Quarterly Estimated Taxes</h2>
                <p className="text-sm text-muted-foreground">
                  Self-employed individuals must pay estimated taxes quarterly to avoid penalties.
                </p>
              </div>
              {!hasQuarterlyFilings && (
                <Button variant="outline" onClick={handleSeedQuarterly} disabled={seeding} className="gap-2">
                  {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  Add {CURRENT_YEAR} Quarters
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {quartersWithFilings.map((quarter) => {
                const isPastDue = isPast(parseISO(quarter.dueDate))
                const daysLeft = differenceInDays(parseISO(quarter.dueDate), new Date())
                const isFiled = quarter.filing?.status === TaxFilingStatus.filed || quarter.filing?.status === TaxFilingStatus.accepted
                const isUrgent = daysLeft >= 0 && daysLeft <= 14

                return (
                  <Card key={quarter.label} className={`relative ${isFiled ? 'border-green-200 dark:border-green-800' : isPastDue && !isFiled ? 'border-destructive/50' : isUrgent ? 'border-orange-200 dark:border-orange-800' : ''}`}>
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <CardTitle className="text-base">{quarter.label} {CURRENT_YEAR}</CardTitle>
                          <p className="text-xs text-muted-foreground mt-0.5">{quarter.period}</p>
                        </div>
                        {isFiled ? (
                          <CheckCircle className="w-5 h-5 text-green-600" />
                        ) : isPastDue ? (
                          <AlertCircle className="w-5 h-5 text-destructive" />
                        ) : isUrgent ? (
                          <Clock className="w-5 h-5 text-orange-500" />
                        ) : null}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Due date</span>
                        <span className="font-medium">{format(parseISO(quarter.dueDate), 'MMM d, yyyy')}</span>
                      </div>
                      {!isFiled && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Status</span>
                          <span className={`font-medium ${isPastDue ? 'text-destructive' : isUrgent ? 'text-orange-500' : 'text-muted-foreground'}`}>
                            {isPastDue ? `${Math.abs(daysLeft)}d overdue` : daysLeft === 0 ? 'Due today' : `${daysLeft}d left`}
                          </span>
                        </div>
                      )}
                      {quarter.filing?.amount_due && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Amount due</span>
                          <span className="font-medium">{formatCurrency(quarter.filing.amount_due)}</span>
                        </div>
                      )}
                      {quarter.filing?.amount_paid && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Amount paid</span>
                          <span className="font-medium text-green-600">{formatCurrency(quarter.filing.amount_paid)}</span>
                        </div>
                      )}

                      <div className="pt-1">
                        {quarter.filing ? (
                          <div className="flex gap-2">
                            {!isFiled && (
                              <Button
                                size="sm"
                                className="flex-1 gap-1"
                                onClick={() => handleMarkFiled(quarter.filing!)}
                              >
                                <CheckCircle className="w-3 h-3" />
                                Mark Paid
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEdit(quarter.filing!)}
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full gap-1"
                            onClick={() => {
                              setFormData({
                                name: `${quarter.label} ${CURRENT_YEAR} Estimated Tax`,
                                form_type: '1040-ES',
                                tax_period_start: quarters.find(q => q.label === quarter.label)?.dueDate.replace(/\d{4}-\d{2}-\d{2}/, `${CURRENT_YEAR}-01-01`) || '',
                                tax_period_end: '',
                                due_date: quarter.dueDate,
                                amount_due: '',
                                amount_paid: '',
                                notes: '',
                              })
                              setSelectedFiling(null)
                              setDialogOpen(true)
                            }}
                          >
                            <Plus className="w-3 h-3" />
                            Add Payment
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>

            {/* 1099 Info (Freelancer) */}
            {accountType === AccountType.freelancer && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    1099 Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-900">
                      <h4 className="font-medium text-sm mb-1">Receiving 1099s</h4>
                      <p className="text-xs text-muted-foreground">
                        Clients who pay you $600+ in a year must send you a 1099-NEC by January 31. You owe tax on this income even without a 1099.
                      </p>
                    </div>
                    <div className="p-4 rounded-lg bg-green-50 dark:bg-green-950 border border-green-100 dark:border-green-900">
                      <h4 className="font-medium text-sm mb-1">Safe Harbor Rule</h4>
                      <p className="text-xs text-muted-foreground">
                        To avoid underpayment penalties, pay 100% of last year's tax liability or 90% of this year's estimated tax — whichever is smaller.
                      </p>
                    </div>
                    <div className="p-4 rounded-lg bg-purple-50 dark:bg-purple-950 border border-purple-100 dark:border-purple-900">
                      <h4 className="font-medium text-sm mb-1">Self-Employment Tax</h4>
                      <p className="text-xs text-muted-foreground">
                        You pay both the employee (7.65%) and employer (7.65%) share — 15.3% total on net earnings. You can deduct half of SE tax from gross income.
                      </p>
                    </div>
                    <div className="p-4 rounded-lg bg-orange-50 dark:bg-orange-950 border border-orange-100 dark:border-orange-900">
                      <h4 className="font-medium text-sm mb-1">Deductible Expenses</h4>
                      <p className="text-xs text-muted-foreground">
                        Home office, equipment, software, health insurance premiums, retirement contributions (SEP-IRA up to 25% of net), and business travel all reduce taxable income.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        {/* ── Filings & Deadlines ── */}
        <TabsContent value="filings" className="mt-4 space-y-4">
          {overdueFiled.length > 0 && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
              <div>
                <p className="text-sm font-medium text-destructive">
                  {overdueFiled.length} overdue {overdueFiled.length === 1 ? 'filing' : 'filings'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {overdueFiled.map(f => f.name).join(', ')}
                </p>
              </div>
            </div>
          )}

          {filings.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground">No filings tracked yet</p>
                <p className="text-sm text-muted-foreground mb-4">Add tax deadlines to stay on top of your obligations</p>
                <div className="flex justify-center gap-2">
                  {accountType !== AccountType.personal && (
                    <Button variant="outline" onClick={handleSeedQuarterly} disabled={seeding} className="gap-2">
                      {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                      Add {CURRENT_YEAR} Quarters
                    </Button>
                  )}
                  <Button onClick={openCreate} className="gap-2">
                    <Plus className="w-4 h-4" />
                    Add Filing
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Filing</TableHead>
                      <TableHead>Form</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead className="text-right">Amount Due</TableHead>
                      <TableHead className="text-right">Amount Paid</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filings.map((filing) => {
                      const dueBadge = getDueBadge(filing.due_date, filing.status)
                      return (
                        <TableRow key={filing.id}>
                          <TableCell className="font-medium">{filing.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-mono text-xs">{filing.form_type}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {filing.tax_period_start && filing.tax_period_end
                              ? `${format(parseISO(filing.tax_period_start), 'MMM d')} – ${format(parseISO(filing.tax_period_end), 'MMM d, yyyy')}`
                              : '—'}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span>{format(parseISO(filing.due_date), 'MMM d, yyyy')}</span>
                              {dueBadge && (
                                <Badge variant={dueBadge.variant} className="text-xs w-fit mt-0.5">
                                  {dueBadge.label}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {filing.amount_due ? formatCurrency(filing.amount_due) : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            {filing.amount_paid
                              ? <span className="text-green-600">{formatCurrency(filing.amount_paid)}</span>
                              : '—'}
                          </TableCell>
                          <TableCell>
                            <Badge variant={getStatusVariant(filing.status)}>
                              {taxFilingStatusLabels[filing.status]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {filing.status !== TaxFilingStatus.filed && filing.status !== TaxFilingStatus.accepted && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Mark as Filed"
                                onClick={() => handleMarkFiled(filing)}
                              >
                                <CheckCircle className="w-4 h-4 text-green-600" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" onClick={() => openEdit(filing)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => { setSelectedFiling(filing); setDeleteDialogOpen(true) }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Tax Estimator ── */}
        {canEstimate && (
          <TabsContent value="estimator" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Inputs */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Income & Expense Inputs</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Estimates use {CURRENT_YEAR} US tax rates. Consult a tax professional for accurate advice.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Gross Income (Annual)</Label>
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-muted-foreground" />
                      <Input
                        type="number"
                        step="100"
                        placeholder="0.00"
                        value={grossIncome}
                        onChange={(e) => setGrossIncome(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Business Expenses (Annual)</Label>
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-muted-foreground" />
                      <Input
                        type="number"
                        step="100"
                        placeholder="0.00"
                        value={expenses}
                        onChange={(e) => setExpenses(e.target.value)}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">Include all deductible business expenses</p>
                  </div>
                </CardContent>
              </Card>

              {/* Results */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Estimated Tax Liability
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm py-2 border-b">
                    <span className="text-muted-foreground">Gross Income</span>
                    <span className="font-medium">{formatCurrency(parseFloat(grossIncome) || 0)}</span>
                  </div>
                  <div className="flex justify-between text-sm py-2 border-b">
                    <span className="text-muted-foreground">Business Expenses</span>
                    <span className="font-medium text-green-600">− {formatCurrency(parseFloat(expenses) || 0)}</span>
                  </div>
                  <div className="flex justify-between text-sm py-2 border-b">
                    <span className="text-muted-foreground">Net Income</span>
                    <span className="font-medium">{formatCurrency(netIncome)}</span>
                  </div>
                  {accountType !== AccountType.personal && (
                    <>
                      <div className="flex justify-between text-sm py-2 border-b">
                        <span className="text-muted-foreground">Self-Employment Tax (15.3%)</span>
                        <span className="font-medium">{formatCurrency(seTax)}</span>
                      </div>
                      <div className="flex justify-between text-sm py-2 border-b">
                        <span className="text-muted-foreground">SE Deduction (½ of SE tax)</span>
                        <span className="font-medium text-green-600">− {formatCurrency(seDeduction)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-sm py-2 border-b">
                    <span className="text-muted-foreground">Est. Federal Income Tax</span>
                    <span className="font-medium">{formatCurrency(federalTax)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-base py-2 border-t-2">
                    <span>Total Estimated Tax</span>
                    <span className={totalTax > 0 ? 'text-orange-600' : ''}>{formatCurrency(totalTax)}</span>
                  </div>
                  {totalTax > 0 && accountType !== AccountType.personal && (
                    <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-900">
                      <p className="text-sm font-medium">Quarterly payment</p>
                      <p className="text-2xl font-bold text-blue-600">{formatCurrency(quarterlyPayment)}</p>
                      <p className="text-xs text-muted-foreground">per quarter (Q1–Q4)</p>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground pt-2">
                    * Estimate only. Uses standard deduction ${accountType === AccountType.personal ? '14,600' : '14,600'} (single), does not include state taxes or retirement deductions.
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        )}

        {/* ── Sales Tax (Business) ── */}
        {canTrackSalesTax && (
          <TabsContent value="salestax" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sales Tax Tracking</CardTitle>
                <p className="text-sm text-muted-foreground">Track sales tax collected and remitted by state</p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="p-4 rounded-lg bg-muted/50 space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Collected YTD</p>
                    <p className="text-2xl font-bold">{formatCurrency(0)}</p>
                    <p className="text-xs text-muted-foreground">from invoices</p>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50 space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Remitted YTD</p>
                    <p className="text-2xl font-bold text-green-600">{formatCurrency(0)}</p>
                    <p className="text-xs text-muted-foreground">paid to states</p>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50 space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Outstanding</p>
                    <p className="text-2xl font-bold text-orange-600">{formatCurrency(0)}</p>
                    <p className="text-xs text-muted-foreground">to be remitted</p>
                  </div>
                </div>
                <div className="text-center py-8 text-muted-foreground">
                  <Receipt className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Sales tax tracking pulls from your invoices.</p>
                  <p className="text-xs mt-1">Add tax rates to invoices to start tracking collected sales tax.</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* ── Create/Edit Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedFiling ? 'Edit Filing' : 'Add Filing'}</DialogTitle>
            <DialogDescription>Track a tax deadline or filing</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Q1 2026 Estimated Tax"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="form_type">Form Type *</Label>
                  <Select
                    value={formData.form_type}
                    onValueChange={(v) => setFormData({ ...formData, form_type: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FORM_TYPES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="due_date">Due Date *</Label>
                  <Input
                    id="due_date"
                    name="due_date"
                    type="date"
                    value={formData.due_date}
                    onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Period Start</Label>
                  <Input
                    type="date"
                    value={formData.tax_period_start}
                    onChange={(e) => setFormData({ ...formData, tax_period_start: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Period End</Label>
                  <Input
                    type="date"
                    value={formData.tax_period_end}
                    onChange={(e) => setFormData({ ...formData, tax_period_end: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Amount Due</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.amount_due}
                    onChange={(e) => setFormData({ ...formData, amount_due: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Amount Paid</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.amount_paid}
                    onChange={(e) => setFormData({ ...formData, amount_paid: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {selectedFiling ? 'Save Changes' : 'Add Filing'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete ── */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Filing</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &quot;{selectedFiling?.name}&quot;? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Export Review ── */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review Tax Export Packet</DialogTitle>
            <DialogDescription>
              Download a CSV summary of tax-year records. Review with a tax professional before filing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Expense total</p>
                <p className="text-lg font-semibold">{formatCurrency(taxExpenseTotal)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Income total</p>
                <p className="text-lg font-semibold">{formatCurrency(taxIncomeTotal)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">CSV rows</p>
                <p className="text-lg font-semibold">{taxPacketRows.length}</p>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-sm font-medium">Included records</p>
              <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-muted-foreground sm:grid-cols-3">
                <p>{taxExpenses.length} expenses</p>
                <p>{taxIncomeInvoices.length} income invoices</p>
                <p>{filings.length} filing deadlines</p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Review flags</p>
              {exportWarnings.length > 0 ? (
                <div className="space-y-2">
                  {exportWarnings.map((warning) => (
                    <div key={warning} className="flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-100">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                  <span>No export blockers detected by Amountly.</span>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setExportDialogOpen(false)}>
              Close
            </Button>
            <Button type="button" onClick={handleDownloadTaxPacket} className="gap-2">
              <Download className="h-4 w-4" />
              Download CSV
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
