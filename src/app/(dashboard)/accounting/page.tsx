'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useAppState } from '@/contexts/AppStateContext'
import {
  getAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  seedDefaultAccounts,
  getJournalEntries,
  createJournalEntry,
  deleteJournalEntry,
  postJournalEntry,
  generateEntryNumber,
} from '@/services/accounting.service'
import type { Account, JournalEntry } from '@/types/models'
import {
  AccountCategory,
  accountCategoryLabels,
  JournalEntryStatus,
  journalEntryStatusLabels,
  Capability,
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
import { DeferredModuleNotice } from '@/components/DeferredModuleNotice'
import { showAdvancedModules } from '@/lib/product-scope'
import {
  Plus,
  BookOpen,
  Pencil,
  Trash2,
  Loader2,
  FileBarChart,
  Landmark,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Wand2,
  Send,
  BarChart3,
  Scale,
} from 'lucide-react'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'

// ─── Helpers ──────────────────────────────────────────────────

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function getEntryStatusVariant(status: JournalEntryStatus): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case JournalEntryStatus.posted: return 'default'
    case JournalEntryStatus.draft: return 'secondary'
    case JournalEntryStatus.voided: return 'outline'
    default: return 'secondary'
  }
}

const categoryOrder = [
  AccountCategory.assets,
  AccountCategory.liabilities,
  AccountCategory.equity,
  AccountCategory.revenue,
  AccountCategory.expenses,
]

const categoryColors: Record<AccountCategory, string> = {
  [AccountCategory.assets]: 'text-blue-600 dark:text-blue-400',
  [AccountCategory.liabilities]: 'text-red-600 dark:text-red-400',
  [AccountCategory.equity]: 'text-purple-600 dark:text-purple-400',
  [AccountCategory.revenue]: 'text-green-600 dark:text-green-400',
  [AccountCategory.expenses]: 'text-orange-600 dark:text-orange-400',
}

// ─── Journal Entry Line Form ──────────────────────────────────

interface JournalLine {
  account_id: string
  description: string
  debit: number
  credit: number
}

// ─── Main Page ────────────────────────────────────────────────

export default function AccountingPage() {
  if (!showAdvancedModules) {
    return <DeferredModuleNotice moduleKey="accounting" />
  }

  return <AccountingWorkspace />
}

function AccountingWorkspace() {
  const { user } = useAuth()
  const { hasCapability } = useAppState()

  const canManageAccounts = hasCapability(Capability.manageChartOfAccounts)
  const canManageEntries = hasCapability(Capability.recordJournalEntries)
  const canReconcile = hasCapability(Capability.reconcileBankAccounts)

  const [accounts, setAccounts] = useState<Account[]>([])
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)

  // Account dialog
  const [accountDialogOpen, setAccountDialogOpen] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null)
  const [savingAccount, setSavingAccount] = useState(false)
  const [accountForm, setAccountForm] = useState({
    code: '',
    name: '',
    category: AccountCategory.assets,
    description: '',
  })

  // Entry dialog
  const [entryDialogOpen, setEntryDialogOpen] = useState(false)
  const [savingEntry, setSavingEntry] = useState(false)
  const [entryForm, setEntryForm] = useState({
    entry_number: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    description: '',
    reference: '',
    notes: '',
  })
  const [journalLines, setJournalLines] = useState<JournalLine[]>([
    { account_id: '', description: '', debit: 0, credit: 0 },
    { account_id: '', description: '', debit: 0, credit: 0 },
  ])

  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'account' | 'entry'; id: string; label: string } | null>(null)

  // Expanded entries
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set())

  // Reconciliation state
  const [statementBalance, setStatementBalance] = useState('')

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      setError(null)
      const [accountsData, entriesData] = await Promise.all([
        getAccounts(),
        getJournalEntries(),
      ])
      setAccounts(accountsData)
      setEntries(entriesData)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load data'
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  // ─── Account CRUD ────────────────────────────────────────────

  const openCreateAccount = () => {
    setSelectedAccount(null)
    setAccountForm({ code: '', name: '', category: AccountCategory.assets, description: '' })
    setAccountDialogOpen(true)
  }

  const openEditAccount = (account: Account) => {
    setSelectedAccount(account)
    setAccountForm({
      code: account.code,
      name: account.name,
      category: account.category,
      description: account.description || '',
    })
    setAccountDialogOpen(true)
  }

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingAccount(true)
    try {
      const input = {
        code: accountForm.code,
        name: accountForm.name,
        category: accountForm.category,
        description: accountForm.description || undefined,
        user_id: user?.id,
        organization_id: user?.organization_id,
        is_active: true,
      }
      if (selectedAccount) {
        await updateAccount(selectedAccount.id, input)
        toast.success('Account updated')
      } else {
        await createAccount(input)
        toast.success('Account created')
      }
      setAccountDialogOpen(false)
      loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save account')
    } finally {
      setSavingAccount(false)
    }
  }

  const handleSeedAccounts = async () => {
    if (!user) return
    setSeeding(true)
    try {
      await seedDefaultAccounts(user.id)
      toast.success('Default chart of accounts added')
      loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to seed accounts')
    } finally {
      setSeeding(false)
    }
  }

  // ─── Journal Entry CRUD ──────────────────────────────────────

  const openCreateEntry = async () => {
    const num = await generateEntryNumber()
    setEntryForm({
      entry_number: num,
      date: format(new Date(), 'yyyy-MM-dd'),
      description: '',
      reference: '',
      notes: '',
    })
    setJournalLines([
      { account_id: '', description: '', debit: 0, credit: 0 },
      { account_id: '', description: '', debit: 0, credit: 0 },
    ])
    setEntryDialogOpen(true)
  }

  const updateJournalLine = (index: number, field: keyof JournalLine, value: string | number) => {
    const updated = [...journalLines]
    updated[index] = { ...updated[index], [field]: value }
    setJournalLines(updated)
  }

  const addJournalLine = () => {
    setJournalLines([...journalLines, { account_id: '', description: '', debit: 0, credit: 0 }])
  }

  const removeJournalLine = (index: number) => {
    if (journalLines.length > 2) {
      setJournalLines(journalLines.filter((_, i) => i !== index))
    }
  }

  const totalDebits = journalLines.reduce((s, l) => s + (l.debit || 0), 0)
  const totalCredits = journalLines.reduce((s, l) => s + (l.credit || 0), 0)
  const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01

  const handleSaveEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isBalanced) {
      toast.error('Debits must equal credits before saving')
      return
    }
    setSavingEntry(true)
    try {
      const input = {
        user_id: user?.id,
        organization_id: user?.organization_id,
        entry_number: entryForm.entry_number,
        date: entryForm.date,
        description: entryForm.description,
        status: JournalEntryStatus.draft,
        reference: entryForm.reference || undefined,
        notes: entryForm.notes || undefined,
      }
      const validLines = journalLines
        .filter((line) => line.account_id)
        .map((line, index) => ({ ...line, order: index }))
      await createJournalEntry(input, validLines)
      toast.success('Journal entry created')
      setEntryDialogOpen(false)
      loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save entry')
    } finally {
      setSavingEntry(false)
    }
  }

  const handlePostEntry = async (entry: JournalEntry) => {
    try {
      const lines = entry.lines?.map(l => ({
        account_id: l.account_id,
        debit: l.debit,
        credit: l.credit,
      })) || []
      await postJournalEntry(entry.id, lines)
      toast.success('Entry posted')
      loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to post entry')
    }
  }

  // ─── Delete ──────────────────────────────────────────────────

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      if (deleteTarget.type === 'account') {
        await deleteAccount(deleteTarget.id)
        toast.success('Account deleted')
      } else {
        await deleteJournalEntry(deleteTarget.id)
        toast.success('Entry deleted')
      }
      setDeleteDialogOpen(false)
      setDeleteTarget(null)
      loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  // ─── Computed data ───────────────────────────────────────────

  const accountsByCategory = categoryOrder.reduce<Record<string, Account[]>>((acc, cat) => {
    acc[cat] = accounts.filter(a => a.category === cat && a.is_active)
    return acc
  }, {} as Record<string, Account[]>)

  const totalAssets = accountsByCategory[AccountCategory.assets]?.reduce((s, a) => s + a.balance, 0) || 0
  const totalLiabilities = accountsByCategory[AccountCategory.liabilities]?.reduce((s, a) => s + a.balance, 0) || 0
  const totalEquity = accountsByCategory[AccountCategory.equity]?.reduce((s, a) => s + a.balance, 0) || 0
  const totalRevenue = accountsByCategory[AccountCategory.revenue]?.reduce((s, a) => s + a.balance, 0) || 0
  const totalExpenses = accountsByCategory[AccountCategory.expenses]?.reduce((s, a) => s + a.balance, 0) || 0
  const netIncome = totalRevenue - totalExpenses

  // Cash accounts for reconciliation
  const cashAccounts = accounts.filter(a =>
    a.category === AccountCategory.assets && (a.code.startsWith('101') || a.code.startsWith('102') || a.name.toLowerCase().includes('cash') || a.name.toLowerCase().includes('checking'))
  )
  const bookCashBalance = cashAccounts.reduce((s, a) => s + a.balance, 0)
  const reconciliationDiff = statementBalance ? parseFloat(statementBalance) - bookCashBalance : null

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
            <BookOpen className="w-12 h-12 mx-auto mb-4 text-destructive opacity-50" />
            <p className="text-destructive font-medium">Error loading accounting data</p>
            <p className="text-sm text-muted-foreground mt-2">{error}</p>
            <Button onClick={loadData} className="mt-4">Try Again</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Accounting</h1>
        <p className="text-muted-foreground">General ledger, financial reports, and chart of accounts</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-600 dark:text-blue-400">Total Assets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalAssets)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-red-600 dark:text-red-400">Total Liabilities</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalLiabilities)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-green-600 dark:text-green-400">Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalRevenue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{netIncome >= 0 ? 'Net Income' : 'Net Loss'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${netIncome >= 0 ? 'text-green-600' : 'text-destructive'}`}>
              {formatCurrency(netIncome)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="chart">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="chart" className="gap-2">
            <BookOpen className="w-4 h-4" />
            <span className="hidden sm:inline">Chart of Accounts</span>
            <span className="sm:hidden">Accounts</span>
          </TabsTrigger>
          <TabsTrigger value="ledger" className="gap-2">
            <FileBarChart className="w-4 h-4" />
            <span className="hidden sm:inline">General Ledger</span>
            <span className="sm:hidden">Ledger</span>
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-2">
            <BarChart3 className="w-4 h-4" />
            Reports
          </TabsTrigger>
          <TabsTrigger value="reconcile" className="gap-2">
            <Scale className="w-4 h-4" />
            <span className="hidden sm:inline">Reconciliation</span>
            <span className="sm:hidden">Reconcile</span>
          </TabsTrigger>
        </TabsList>

        {/* ── Chart of Accounts ── */}
        <TabsContent value="chart" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{accounts.length} accounts</p>
            <div className="flex gap-2">
              {canManageAccounts && accounts.length === 0 && (
                <Button variant="outline" onClick={handleSeedAccounts} disabled={seeding} className="gap-2">
                  {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  Load US GAAP Defaults
                </Button>
              )}
              {canManageAccounts && (
                <Button onClick={openCreateAccount} className="gap-2">
                  <Plus className="w-4 h-4" />
                  Add Account
                </Button>
              )}
            </div>
          </div>

          {accounts.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <BookOpen className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground">No accounts yet</p>
                <p className="text-sm text-muted-foreground mb-4">Start with the US GAAP default chart of accounts</p>
                {canManageAccounts && (
                  <Button onClick={handleSeedAccounts} disabled={seeding} className="gap-2">
                    {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                    Load US GAAP Defaults
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {categoryOrder.map((category) => {
                const catAccounts = accountsByCategory[category]
                if (!catAccounts?.length) return null
                const catTotal = catAccounts.reduce((s, a) => s + a.balance, 0)
                return (
                  <Card key={category}>
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-center">
                        <CardTitle className={`text-sm font-semibold uppercase tracking-wide ${categoryColors[category]}`}>
                          {accountCategoryLabels[category]}
                        </CardTitle>
                        <span className="text-sm font-medium">{formatCurrency(catTotal)}</span>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-24">Code</TableHead>
                            <TableHead>Account Name</TableHead>
                            <TableHead className="text-right">Balance</TableHead>
                            {canManageAccounts && <TableHead className="w-20 text-right">Actions</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {catAccounts.map((account) => (
                            <TableRow key={account.id}>
                              <TableCell className="font-mono text-sm text-muted-foreground">{account.code}</TableCell>
                              <TableCell>
                                <div>
                                  <span className="font-medium">{account.name}</span>
                                  {account.description && (
                                    <p className="text-xs text-muted-foreground">{account.description}</p>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-medium">{formatCurrency(account.balance)}</TableCell>
                              {canManageAccounts && (
                                <TableCell className="text-right">
                                  <Button variant="ghost" size="icon" onClick={() => openEditAccount(account)}>
                                    <Pencil className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                      setDeleteTarget({ type: 'account', id: account.id, label: account.name })
                                      setDeleteDialogOpen(true)
                                    }}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* ── General Ledger ── */}
        <TabsContent value="ledger" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              {entries.length} entries · {entries.filter(e => e.status === JournalEntryStatus.posted).length} posted
            </p>
            {canManageEntries && (
              <Button onClick={openCreateEntry} className="gap-2">
                <Plus className="w-4 h-4" />
                New Entry
              </Button>
            )}
          </div>

          {entries.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <FileBarChart className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground">No journal entries yet</p>
                {canManageEntries && (
                  <Button onClick={openCreateEntry} className="mt-4 gap-2">
                    <Plus className="w-4 h-4" />
                    New Entry
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>Entry #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Debits</TableHead>
                      <TableHead className="text-right">Credits</TableHead>
                      <TableHead>Status</TableHead>
                      {canManageEntries && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => {
                      const isExpanded = expandedEntries.has(entry.id)
                      const entryDebits = entry.lines?.reduce((s, l) => s + l.debit, 0) || 0
                      const entryCredits = entry.lines?.reduce((s, l) => s + l.credit, 0) || 0
                      return (
                        <>
                          <TableRow
                            key={entry.id}
                            className="cursor-pointer"
                            onClick={() => {
                              const next = new Set(expandedEntries)
                              isExpanded ? next.delete(entry.id) : next.add(entry.id)
                              setExpandedEntries(next)
                            }}
                          >
                            <TableCell>
                              {isExpanded
                                ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                : <ChevronRight className="w-4 h-4 text-muted-foreground" />
                              }
                            </TableCell>
                            <TableCell className="font-mono font-medium">{entry.entry_number}</TableCell>
                            <TableCell>{format(parseISO(entry.date), 'MMM d, yyyy')}</TableCell>
                            <TableCell>{entry.description}</TableCell>
                            <TableCell className="text-right">{formatCurrency(entryDebits)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(entryCredits)}</TableCell>
                            <TableCell>
                              <Badge variant={getEntryStatusVariant(entry.status)}>
                                {journalEntryStatusLabels[entry.status]}
                              </Badge>
                            </TableCell>
                            {canManageEntries && (
                              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                {entry.status === JournalEntryStatus.draft && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Post Entry"
                                    onClick={() => handlePostEntry(entry)}
                                  >
                                    <Send className="w-4 h-4 text-green-600" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    setDeleteTarget({ type: 'entry', id: entry.id, label: entry.entry_number })
                                    setDeleteDialogOpen(true)
                                  }}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                          {isExpanded && entry.lines && entry.lines.length > 0 && (
                            <TableRow key={`${entry.id}-lines`}>
                              <TableCell colSpan={canManageEntries ? 8 : 7} className="bg-muted/30 py-2">
                                <div className="pl-8 pr-4">
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="text-muted-foreground">
                                        <th className="text-left font-medium pb-1">Account</th>
                                        <th className="text-left font-medium pb-1">Description</th>
                                        <th className="text-right font-medium pb-1">Debit</th>
                                        <th className="text-right font-medium pb-1">Credit</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {entry.lines.map((line) => (
                                        <tr key={line.id}>
                                          <td className="py-0.5 font-mono text-xs">
                                            {line.account?.code} — {line.account?.name}
                                          </td>
                                          <td className="py-0.5 text-muted-foreground">{line.description || '—'}</td>
                                          <td className="py-0.5 text-right">{line.debit > 0 ? formatCurrency(line.debit) : '—'}</td>
                                          <td className="py-0.5 text-right">{line.credit > 0 ? formatCurrency(line.credit) : '—'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Financial Reports ── */}
        <TabsContent value="reports" className="mt-4">
          <Tabs defaultValue="pl">
            <TabsList>
              <TabsTrigger value="pl" className="gap-2">
                <BarChart3 className="w-4 h-4" />
                Profit & Loss
              </TabsTrigger>
              <TabsTrigger value="bs" className="gap-2">
                <Scale className="w-4 h-4" />
                Balance Sheet
              </TabsTrigger>
            </TabsList>

            {/* P&L */}
            <TabsContent value="pl" className="mt-4 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Profit & Loss Statement</CardTitle>
                  <p className="text-sm text-muted-foreground">Based on current account balances</p>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Revenue */}
                  <div>
                    <h3 className="font-semibold text-green-600 dark:text-green-400 mb-2 text-sm uppercase tracking-wide">Revenue</h3>
                    <div className="space-y-1">
                      {accountsByCategory[AccountCategory.revenue]?.map(a => (
                        <div key={a.id} className="flex justify-between text-sm py-1 border-b border-muted last:border-0">
                          <span className="text-muted-foreground">{a.code} — {a.name}</span>
                          <span className="font-medium">{formatCurrency(a.balance)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between font-semibold mt-2 pt-2 border-t">
                      <span>Total Revenue</span>
                      <span className="text-green-600">{formatCurrency(totalRevenue)}</span>
                    </div>
                  </div>

                  {/* Expenses */}
                  <div>
                    <h3 className="font-semibold text-orange-600 dark:text-orange-400 mb-2 text-sm uppercase tracking-wide">Expenses</h3>
                    <div className="space-y-1">
                      {accountsByCategory[AccountCategory.expenses]?.map(a => (
                        <div key={a.id} className="flex justify-between text-sm py-1 border-b border-muted last:border-0">
                          <span className="text-muted-foreground">{a.code} — {a.name}</span>
                          <span className="font-medium">{formatCurrency(a.balance)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between font-semibold mt-2 pt-2 border-t">
                      <span>Total Expenses</span>
                      <span className="text-orange-600">{formatCurrency(totalExpenses)}</span>
                    </div>
                  </div>

                  {/* Net Income */}
                  <div className={`flex justify-between text-lg font-bold pt-4 border-t-2 ${netIncome >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                    <span>{netIncome >= 0 ? 'Net Income' : 'Net Loss'}</span>
                    <span>{formatCurrency(Math.abs(netIncome))}</span>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Balance Sheet */}
            <TabsContent value="bs" className="mt-4 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Balance Sheet</CardTitle>
                  <p className="text-sm text-muted-foreground">Assets = Liabilities + Equity</p>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Assets */}
                  <div>
                    <h3 className="font-semibold text-blue-600 dark:text-blue-400 mb-2 text-sm uppercase tracking-wide">Assets</h3>
                    <div className="space-y-1">
                      {accountsByCategory[AccountCategory.assets]?.map(a => (
                        <div key={a.id} className="flex justify-between text-sm py-1 border-b border-muted last:border-0">
                          <span className="text-muted-foreground">{a.code} — {a.name}</span>
                          <span className="font-medium">{formatCurrency(a.balance)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between font-semibold mt-2 pt-2 border-t">
                      <span>Total Assets</span>
                      <span className="text-blue-600">{formatCurrency(totalAssets)}</span>
                    </div>
                  </div>

                  {/* Liabilities */}
                  <div>
                    <h3 className="font-semibold text-red-600 dark:text-red-400 mb-2 text-sm uppercase tracking-wide">Liabilities</h3>
                    <div className="space-y-1">
                      {accountsByCategory[AccountCategory.liabilities]?.map(a => (
                        <div key={a.id} className="flex justify-between text-sm py-1 border-b border-muted last:border-0">
                          <span className="text-muted-foreground">{a.code} — {a.name}</span>
                          <span className="font-medium">{formatCurrency(a.balance)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between font-semibold mt-2 pt-2 border-t">
                      <span>Total Liabilities</span>
                      <span className="text-red-600">{formatCurrency(totalLiabilities)}</span>
                    </div>
                  </div>

                  {/* Equity */}
                  <div>
                    <h3 className="font-semibold text-purple-600 dark:text-purple-400 mb-2 text-sm uppercase tracking-wide">Equity</h3>
                    <div className="space-y-1">
                      {accountsByCategory[AccountCategory.equity]?.map(a => (
                        <div key={a.id} className="flex justify-between text-sm py-1 border-b border-muted last:border-0">
                          <span className="text-muted-foreground">{a.code} — {a.name}</span>
                          <span className="font-medium">{formatCurrency(a.balance)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between font-semibold mt-2 pt-2 border-t">
                      <span>Total Equity</span>
                      <span className="text-purple-600">{formatCurrency(totalEquity)}</span>
                    </div>
                  </div>

                  {/* Check */}
                  <div className={`flex justify-between text-lg font-bold pt-4 border-t-2 ${Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01 ? 'text-green-600' : 'text-destructive'}`}>
                    <span>Total Liabilities + Equity</span>
                    <span>{formatCurrency(totalLiabilities + totalEquity)}</span>
                  </div>
                  {Math.abs(totalAssets - (totalLiabilities + totalEquity)) > 0.01 && (
                    <p className="text-sm text-destructive">⚠ Balance sheet is out of balance — post journal entries to correct.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* ── Bank Reconciliation ── */}
        <TabsContent value="reconcile" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Landmark className="w-5 h-5" />
                Bank Reconciliation
              </CardTitle>
              <p className="text-sm text-muted-foreground">Compare your bank statement to your book balance</p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Bank Statement */}
                <div className="space-y-4">
                  <h3 className="font-semibold">Bank Statement</h3>
                  <div className="space-y-2">
                    <Label>Ending Balance on Statement</Label>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={statementBalance}
                        onChange={(e) => setStatementBalance(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* Book Balance */}
                <div className="space-y-4">
                  <h3 className="font-semibold">Book Balance</h3>
                  <div className="space-y-2">
                    {cashAccounts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No cash/checking accounts found in Chart of Accounts.</p>
                    ) : (
                      <>
                        {cashAccounts.map(a => (
                          <div key={a.id} className="flex justify-between text-sm py-1 border-b border-muted">
                            <span>{a.code} — {a.name}</span>
                            <span className="font-medium">{formatCurrency(a.balance)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between font-semibold pt-1">
                          <span>Total Book Balance</span>
                          <span>{formatCurrency(bookCashBalance)}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Difference */}
              {reconciliationDiff !== null && (
                <div className={`p-4 rounded-lg border ${Math.abs(reconciliationDiff) < 0.01 ? 'bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800' : 'bg-orange-50 border-orange-200 dark:bg-orange-950 dark:border-orange-800'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {Math.abs(reconciliationDiff) < 0.01 ? (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      ) : (
                        <Scale className="w-5 h-5 text-orange-600" />
                      )}
                      <span className="font-semibold">
                        {Math.abs(reconciliationDiff) < 0.01 ? 'Accounts Reconciled' : 'Unreconciled Difference'}
                      </span>
                    </div>
                    <span className={`text-xl font-bold ${Math.abs(reconciliationDiff) < 0.01 ? 'text-green-600' : 'text-orange-600'}`}>
                      {formatCurrency(Math.abs(reconciliationDiff))}
                    </span>
                  </div>
                  {Math.abs(reconciliationDiff) > 0.01 && (
                    <p className="text-sm text-muted-foreground mt-2">
                      {reconciliationDiff > 0
                        ? 'Bank balance is higher than book balance. Check for unrecorded deposits or bank errors.'
                        : 'Book balance is higher than bank balance. Check for outstanding checks or unrecorded withdrawals.'}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Account Dialog ── */}
      <Dialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedAccount ? 'Edit Account' : 'Add Account'}</DialogTitle>
            <DialogDescription>
              {selectedAccount ? 'Update account details' : 'Add a new account to the chart of accounts'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveAccount}>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="code">Account Code *</Label>
                  <Input
                    id="code"
                    value={accountForm.code}
                    onChange={(e) => setAccountForm({ ...accountForm, code: e.target.value })}
                    placeholder="e.g. 1010"
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="category">Category *</Label>
                  <Select
                    value={accountForm.category}
                    onValueChange={(v) => setAccountForm({ ...accountForm, category: v as AccountCategory })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {categoryOrder.map(cat => (
                        <SelectItem key={cat} value={cat}>{accountCategoryLabels[cat]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Account Name *</Label>
                <Input
                  id="name"
                  value={accountForm.name}
                  onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
                  placeholder="e.g. Cash & Cash Equivalents"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={accountForm.description}
                  onChange={(e) => setAccountForm({ ...accountForm, description: e.target.value })}
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAccountDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={savingAccount}>
                {savingAccount && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {selectedAccount ? 'Save Changes' : 'Add Account'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Journal Entry Dialog ── */}
      <Dialog open={entryDialogOpen} onOpenChange={setEntryDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Journal Entry</DialogTitle>
            <DialogDescription>Record a double-entry bookkeeping transaction</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveEntry}>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Entry Number</Label>
                  <Input value={entryForm.entry_number} readOnly className="bg-muted" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="date">Date *</Label>
                  <Input
                    id="date"
                    type="date"
                    value={entryForm.date}
                    onChange={(e) => setEntryForm({ ...entryForm, date: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reference">Reference</Label>
                  <Input
                    id="reference"
                    value={entryForm.reference}
                    onChange={(e) => setEntryForm({ ...entryForm, reference: e.target.value })}
                    placeholder="INV-001, etc."
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description *</Label>
                <Input
                  id="description"
                  value={entryForm.description}
                  onChange={(e) => setEntryForm({ ...entryForm, description: e.target.value })}
                  placeholder="Brief description of the transaction"
                  required
                />
              </div>

              {/* Lines */}
              <div className="space-y-2">
                <Label>Lines</Label>
                <div className="border rounded-lg p-3 space-y-2">
                  <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-1">
                    <div className="col-span-4">Account</div>
                    <div className="col-span-3">Description</div>
                    <div className="col-span-2 text-right">Debit</div>
                    <div className="col-span-2 text-right">Credit</div>
                    <div className="col-span-1" />
                  </div>
                  {journalLines.map((line, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-4">
                        <Select
                          value={line.account_id}
                          onValueChange={(v) => updateJournalLine(index, 'account_id', v)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select account" />
                          </SelectTrigger>
                          <SelectContent>
                            {categoryOrder.map(cat => (
                              <div key={cat}>
                                <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase">
                                  {accountCategoryLabels[cat]}
                                </div>
                                {accountsByCategory[cat]?.map(a => (
                                  <SelectItem key={a.id} value={a.id} className="text-xs">
                                    {a.code} — {a.name}
                                  </SelectItem>
                                ))}
                              </div>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-3">
                        <Input
                          className="h-8 text-xs"
                          placeholder="Note"
                          value={line.description}
                          onChange={(e) => updateJournalLine(index, 'description', e.target.value)}
                        />
                      </div>
                      <div className="col-span-2">
                        <Input
                          className="h-8 text-xs text-right"
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.debit || ''}
                          placeholder="0.00"
                          onChange={(e) => updateJournalLine(index, 'debit', parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="col-span-2">
                        <Input
                          className="h-8 text-xs text-right"
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.credit || ''}
                          placeholder="0.00"
                          onChange={(e) => updateJournalLine(index, 'credit', parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="col-span-1 flex justify-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => removeJournalLine(index)}
                          disabled={journalLines.length <= 2}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}

                  <Button type="button" variant="outline" size="sm" onClick={addJournalLine}>
                    <Plus className="w-3 h-3 mr-1" /> Add Line
                  </Button>

                  {/* Totals row */}
                  <div className="grid grid-cols-12 gap-2 border-t pt-2 mt-1">
                    <div className="col-span-7 text-right text-sm font-medium">Totals:</div>
                    <div className={`col-span-2 text-right text-sm font-medium ${isBalanced ? '' : 'text-destructive'}`}>
                      {formatCurrency(totalDebits)}
                    </div>
                    <div className={`col-span-2 text-right text-sm font-medium ${isBalanced ? '' : 'text-destructive'}`}>
                      {formatCurrency(totalCredits)}
                    </div>
                    <div className="col-span-1" />
                  </div>
                  {!isBalanced && (
                    <p className="text-xs text-destructive">
                      Difference: {formatCurrency(Math.abs(totalDebits - totalCredits))} — debits must equal credits
                    </p>
                  )}
                  {isBalanced && totalDebits > 0 && (
                    <p className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> Entry is balanced
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={entryForm.notes}
                  onChange={(e) => setEntryForm({ ...entryForm, notes: e.target.value })}
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEntryDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={savingEntry || !isBalanced}>
                {savingEntry && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save as Draft
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ── */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.type === 'account' ? 'Account' : 'Journal Entry'}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.label}&quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
