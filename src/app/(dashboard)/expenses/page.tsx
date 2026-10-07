'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { getExpenses, createExpense, updateExpense, archiveExpense, uploadReceipt, getReceiptUrl } from '@/services/expenses.service'
import { useCreateAttempt } from '@/hooks/useCreateAttempt'
import { SaveAttemptNotice } from '@/components/SaveAttemptNotice'
import { RecordHistoryDialog } from '@/components/RecordHistoryDialog'
import { getProjects } from '@/services/projects.service'
import type { Expense, Project } from '@/types/models'
import { ExpenseStatus, ExpenseCategory, expenseStatusLabels, expenseCategoryLabels } from '@/types/enums'
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
import { Plus, Receipt, Pencil, Trash2, Loader2, Wand2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { dateInputValue } from '@/lib/date-format'
import { useDisplayDate } from '@/hooks/useDisplayDate'
import { captureExpenseFromText, captureReceiptDocumentFromText, captureReceiptFromFile } from '@/lib/expense-ai'
import { supportedReceiptCurrencies, type ReceiptFileCaptureResult } from '@/lib/ai/receipt-contract'
import { expenseTotalsByCurrency, findPossibleReceiptDuplicate, isSupportedReceiptCurrency, receiptDraftIsComplete, receiptExpenseFields } from '@/lib/receipt-review'

function formatExpenseAmount(amount: number, currency: string) {
  if (!Number.isFinite(amount)) return 'Amount unavailable'
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'code' }).format(amount)
  } catch { return `${amount.toFixed(2)} (currency unavailable)` }
}

function getStatusVariant(status: ExpenseStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case ExpenseStatus.approved:
    case ExpenseStatus.reimbursed:
      return 'default'
    case ExpenseStatus.submitted:
      return 'secondary'
    case ExpenseStatus.rejected:
      return 'destructive'
    default:
      return 'outline'
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message
  }

  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }

  return fallback
}

export default function ExpensesPage() {
  const formatDateOnly = useDisplayDate()
  const { user } = useAuth()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null)
  const [historyId,setHistoryId]=useState<string|null>(null)
  const [saving, setSaving] = useState(false)
  const [smartCaptureText, setSmartCaptureText] = useState('')
  const [smartCaptureSummary, setSmartCaptureSummary] = useState<string | null>(null)
  const [receiptText, setReceiptText] = useState('')
  const [receiptSummary, setReceiptSummary] = useState<string | null>(null)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptFileInputKey, setReceiptFileInputKey] = useState(0)
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null)
  const [receiptFileResult, setReceiptFileResult] = useState<ReceiptFileCaptureResult | null>(null)
  const [receiptSourceFile, setReceiptSourceFile] = useState<File | null>(null)
  const [receiptReviewed, setReceiptReviewed] = useState(false)
  const [extracting, setExtracting] = useState<'file' | 'receipt_text' | 'smart_text' | null>(null)
  const extraction = useRef<{ version: number; controller: AbortController | null }>({ version: 0, controller: null })

  const [formData, setFormData] = useState({
    amount: '',
    currency: 'USD',
    category: ExpenseCategory.other,
    description: '',
    merchant: '',
    expense_date: format(new Date(), 'yyyy-MM-dd'),
    project_id: '',
    notes: '',
  })

  useEffect(() => {
    if (user) loadData()
  }, [user?.id, user?.organization_id])

  useEffect(() => {
    if (!dialogOpen || !receiptFile || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(receiptFile.type)) {
      setReceiptPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(receiptFile)
    setReceiptPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [dialogOpen, receiptFile])

  useEffect(() => () => { extraction.current.controller?.abort() }, [])

  const loadData = async () => {
    try {
      setError(null)
      const [expensesData, projectsData] = await Promise.all([
        getExpenses(),
        getProjects({
          userId: user?.id,
          organizationId: user?.organization_id,
        }),
      ])
      setExpenses(expensesData)
      setProjects(projectsData)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load data'
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const createAttempt = useCreateAttempt<Parameters<typeof createExpense>[0]>()
  const uploadedReceipt = useRef<{ file: File; path: string } | null>(null)

  const cancelExtraction = () => {
    extraction.current.controller?.abort()
    extraction.current = { version: extraction.current.version + 1, controller: null }
    setExtracting(null)
  }
  const resetReceiptReview = () => {
    cancelExtraction()
    setReceiptFileResult(null)
    setReceiptSourceFile(null)
    setReceiptReviewed(false)
    setReceiptSummary(null)
    setReceiptFileInputKey(previous => previous + 1)
  }
  const changeReceiptFile = (file: File | null) => {
    cancelExtraction()
    setReceiptReviewed(false)
    setReceiptSummary(receiptFileResult ? 'The selected receipt changed. Review the existing draft or extract the new receipt before saving.' : null)
    uploadedReceipt.current = null
    setReceiptFile(file)
    if (!file) setReceiptFileInputKey(previous => previous + 1)
  }
  const changeFormData = (patch: Partial<typeof formData>) => {
    cancelExtraction()
    setReceiptReviewed(false)
    setFormData(current => ({ ...current, ...patch }))
  }
  const closeExpenseDialog = () => {
    cancelExtraction()
    setDialogOpen(false)
  }
  const beginExtraction = (kind: NonNullable<typeof extracting>) => {
    if (extraction.current.controller || saving || createAttempt.unknown) return null
    const current = { version: extraction.current.version + 1, controller: new AbortController() }
    extraction.current = current
    setExtracting(kind)
    return current
  }
  const extractionIsCurrent = (current: { version: number; controller: AbortController }) =>
    extraction.current.version === current.version && !current.controller.signal.aborted
  const finishExtraction = (current: { version: number; controller: AbortController }) => {
    if (extractionIsCurrent(current)) {
      extraction.current.controller = null
      setExtracting(null)
    }
  }

  const openCreateDialog = () => {
    if (!createAttempt.reset()) { setDialogOpen(true); return }
    resetReceiptReview()
    uploadedReceipt.current = null
    setSelectedExpense(null)
    setFormData({
      amount: '',
      currency: 'USD',
      category: ExpenseCategory.other,
      description: '',
      merchant: '',
      expense_date: format(new Date(), 'yyyy-MM-dd'),
      project_id: '',
      notes: '',
    })
    setSmartCaptureText('')
    setSmartCaptureSummary(null)
    setReceiptText('')
    setReceiptSummary(null)
    setReceiptFile(null)
    setDialogOpen(true)
  }

  const openEditDialog = (expense: Expense) => {
    if (!createAttempt.reset()) { setDialogOpen(true); return }
    resetReceiptReview()
    uploadedReceipt.current = null
    setSelectedExpense(expense)
    setFormData({
      amount: expense.amount.toString(),
      currency: isSupportedReceiptCurrency(expense.currency) ? expense.currency : '',
      category: expense.category,
      description: expense.description || '',
      merchant: expense.merchant || '',
      expense_date: dateInputValue(expense.expense_date),
      project_id: expense.project_id || '',
      notes: expense.notes || '',
    })
    setSmartCaptureText('')
    setSmartCaptureSummary(null)
    setReceiptText('')
    setReceiptSummary(null)
    setReceiptFile(null)
    setDialogOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving || extraction.current.controller) return
    if (!createAttempt.unknown && receiptFileResult && !receiptReviewed) {
      toast.error('Review the extracted receipt and confirm the details before saving.')
      return
    }
    if (!createAttempt.unknown && receiptFileResult && !receiptDraftIsComplete(formData)) {
      toast.error('Confirm a valid amount, date, and supported currency from the receipt before saving.')
      return
    }
    if (!createAttempt.unknown && !isSupportedReceiptCurrency(formData.currency)) {
      toast.error('Choose the currency shown on the receipt before saving.')
      return
    }
    setSaving(true)

    try {
      if (receiptFile && uploadedReceipt.current?.file !== receiptFile) {
        uploadedReceipt.current = { file: receiptFile, path: await uploadReceipt(receiptFile) }
      }
      const receiptPath = receiptFile ? uploadedReceipt.current?.path : selectedExpense?.receipt_path
      const expenseData = {
        user_id: user?.id!,
        amount: Number(formData.amount),
        currency: formData.currency,
        category: formData.category,
        description: formData.description || undefined,
        merchant: formData.merchant || undefined,
        expense_date: formData.expense_date,
        project_id: formData.project_id || undefined,
        notes: formData.notes || undefined,
        receipt_path: receiptPath || undefined,
        status: selectedExpense?.status === ExpenseStatus.rejected ? ExpenseStatus.draft : selectedExpense?.status ?? ExpenseStatus.draft,
      }

      if (selectedExpense) {
        await updateExpense(selectedExpense.id, expenseData, selectedExpense.updated_at)
        toast.success('Expense updated')
      } else {
        await createAttempt.run(expenseData, createExpense)
        toast.success('Expense created')
      }
      closeExpenseDialog()
      loadData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not confirm the save. Review the expense before trying again.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedExpense) return

    try {
      await archiveExpense(selectedExpense.id, selectedExpense.updated_at)
      toast.success('Expense archived; history preserved')
      setDeleteDialogOpen(false)
      setSelectedExpense(null)
      loadData()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to delete expense'))
    }
  }

  const currencyTotals = expenseTotalsByCurrency(expenses)
  const handleSmartCapture = async () => {
    const current = beginExtraction('smart_text')
    if (!current) return
    try {
      setSmartCaptureSummary('Asking Amountly AI...')
      const result = await captureExpenseFromText(smartCaptureText)
      if (!extractionIsCurrent(current)) return
      const nextFormData = {
        ...formData,
        amount: result.amount ?? formData.amount,
        merchant: result.merchant ?? formData.merchant,
        description: result.description ?? formData.description,
        expense_date: result.expense_date ?? formData.expense_date,
        category: result.category,
      }

      setFormData(nextFormData)
      setReceiptReviewed(false)
      setSmartCaptureSummary(
        `Filled ${[
          result.amount ? 'amount' : null,
          result.merchant ? 'merchant' : null,
          result.expense_date ? 'date' : null,
          'category',
        ]
          .filter(Boolean)
          .join(', ')}.`
      )
    } catch (error) {
      if (!extractionIsCurrent(current)) return
      const message = getErrorMessage(error, 'AI capture failed')
      setSmartCaptureSummary(message)
      toast.error(message)
    } finally { finishExtraction(current) }
  }
  const handleReceiptExtraction = async () => {
    const current = beginExtraction('receipt_text')
    if (!current) return
    try {
      setReceiptSummary('Asking Amountly AI...')
      const result = await captureReceiptDocumentFromText(receiptText)
      if (!extractionIsCurrent(current)) return
      setFormData({
        ...formData,
        amount: result.amount ?? formData.amount,
        merchant: result.merchant ?? formData.merchant,
        description: result.description ?? formData.description,
        expense_date: result.expense_date ?? formData.expense_date,
        category: result.category,
        notes: result.notes ?? formData.notes,
      })
      setReceiptReviewed(false)
      setReceiptSummary(result.summary)
    } catch (error) {
      if (!extractionIsCurrent(current)) return
      const message = getErrorMessage(error, 'Receipt extraction failed')
      setReceiptSummary(message)
      toast.error(message)
    } finally { finishExtraction(current) }
  }

  const handleReceiptFileExtraction = async () => {
    if (!receiptFile) return
    const current = beginExtraction('file')
    if (!current) return
    setReceiptReviewed(false)
    setReceiptSummary('Reading the selected receipt...')
    try {
      const result = await captureReceiptFromFile(receiptFile, current.controller.signal)
      if (!extractionIsCurrent(current)) return
      const fields = receiptExpenseFields(result)
      if (!fields) {
        setReceiptSummary('This looks like an invoice, statement, or another document. This feature reads receipts only. Enter an expense manually if appropriate.')
        return
      }
      setFormData(previous => ({ ...previous, ...fields }))
      setReceiptFileResult(result)
      setReceiptSourceFile(receiptFile)
      setSmartCaptureSummary(null)
      setReceiptSummary(result.summary || 'Receipt fields are ready for your review.')
    } catch (error) {
      if (!extractionIsCurrent(current)) return
      const message = getErrorMessage(error, 'Receipt extraction failed. You can enter the details manually.')
      setReceiptSummary(message)
      toast.error(message)
    } finally { finishExtraction(current) }
  }

  const possibleReceiptDuplicate = receiptFileResult
    ? findPossibleReceiptDuplicate(formData, expenses.filter(expense => expense.user_id === user?.id), selectedExpense?.id) : undefined

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
            <Receipt className="w-12 h-12 mx-auto mb-4 text-destructive opacity-50" />
            <p className="text-destructive font-medium">Error loading data</p>
            <p className="text-sm text-muted-foreground mt-2">{error}</p>
            <Button onClick={loadData} className="mt-4">
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Expenses</h1>
          <p className="text-muted-foreground">Track and manage your expenses</p>
        </div>
        <Button onClick={openCreateDialog} className="gap-2">
          <Plus className="w-4 h-4" />
          Add Expense
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{expenses.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total by Currency</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-2xl font-bold">
              {currencyTotals.length ? currencyTotals.map(total => <div key={total.currency}>{formatExpenseAmount(total.amount, total.currency)}</div>) : 'No expenses'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {expenses.filter(e => e.status === ExpenseStatus.submitted).length}
            </div>
          </CardContent>
        </Card>
      </div>

      {expenses.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Receipt className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">No expenses yet</p>
            <p className="text-sm text-muted-foreground">Add your first expense to track spending</p>
            <Button onClick={openCreateDialog} className="mt-4 gap-2">
              <Plus className="w-4 h-4" />
              Add Expense
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              All Expenses
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((expense) => (
                  <TableRow key={expense.id}>
                    <TableCell>
                      {formatDateOnly(expense.expense_date)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {expenseCategoryLabels[expense.category]}
                      </Badge>
                    </TableCell>
                    <TableCell>{expense.merchant || '-'}</TableCell>
                    <TableCell className="max-w-xs truncate">
                      {expense.description || '-'}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatExpenseAmount(expense.amount, expense.currency)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(expense.status)}>
                        {expenseStatusLabels[expense.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={()=>setHistoryId(expense.id)}>History</Button>
                      {(expense.receipt_path || expense.receipt_url) && <Button variant="ghost" size="sm" onClick={async () => {
                        try { const url = await getReceiptUrl(expense); window.open(url, '_blank', 'noopener,noreferrer') }
                        catch { toast.error('Could not open receipt. Check your access and try again.') }
                      }}>Receipt</Button>}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(expense)}
                        aria-label="Edit expense"
                        disabled={!['DRAFT','REJECTED'].includes(expense.status)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Archive expense"
                        disabled={!['DRAFT','REJECTED'].includes(expense.status)}
                        onClick={() => {
                          setSelectedExpense(expense)
                          setDeleteDialogOpen(true)
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={open => { if (!saving) { if (open) setDialogOpen(true); else closeExpenseDialog() } }}>
        <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedExpense ? 'Edit Expense' : 'Add Expense'}
            </DialogTitle>
            <DialogDescription>
              {selectedExpense ? 'Update expense details' : 'Record a new expense'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <SaveAttemptNotice message={createAttempt.message} />
            <fieldset disabled={saving || createAttempt.unknown} className="grid gap-4 py-4">
              {!selectedExpense && (
                <div className="rounded-lg border bg-primary/5 p-3">
                  <div className="mb-3 flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Wand2 className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Smart capture</p>
                      <p className="text-sm text-muted-foreground">
                        Paste a receipt line or describe the expense and Amountly will prefill what it can.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <Textarea
                      disabled={!!extracting}
                      value={smartCaptureText}
                      onChange={(e) => {
                        setSmartCaptureText(e.target.value)
                        setSmartCaptureSummary(null)
                      }}
                      placeholder="Example: Starbucks $12.48 coffee with client yesterday"
                      rows={2}
                    />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-muted-foreground">
                        {smartCaptureSummary || 'Amountly looks for amount, merchant, date, and category signals.'}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleSmartCapture}
                        disabled={!!extracting || !smartCaptureText.trim()}
                        className="shrink-0 gap-2"
                      >
                        <Wand2 className="h-4 w-4" />
                        Extract details
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="mb-3 flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Receipt className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Read a receipt</p>
                    <p className="text-sm text-muted-foreground">
                      Choose one receipt to fill an expense draft, then review the details before saving.
                    </p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="receipt_file">Receipt file</Label>
                    <Input
                      key={receiptFileInputKey}
                      id="receipt_file"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      onChange={(e) => changeReceiptFile(e.target.files?.[0] ?? null)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {receiptFile ? `${receiptFile.name} will be attached when you save.` : (selectedExpense?.receipt_path || selectedExpense?.receipt_url) ? 'Existing receipt will stay attached unless replaced.' : 'JPEG, PNG, WebP, or PDF. Up to 10 MB; PDFs up to 5 pages.'}
                    </p>
                  </div>
                  {receiptPreviewUrl && receiptFile && (
                    receiptFile.type === 'application/pdf'
                      ? <a href={receiptPreviewUrl} download="receipt.pdf" className="inline-block text-sm underline">Download selected PDF to review</a>
                      : <img src={receiptPreviewUrl} alt="Selected receipt preview" className="max-h-40 w-full rounded border object-contain" />
                  )}
                  <p className="text-xs text-muted-foreground">
                    Extracting sends the selected receipt to OpenAI for processing. Check the amount, currency, date, and category against the original. AI can make mistakes.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={handleReceiptFileExtraction} disabled={!receiptFile || !!extracting} className="gap-2">
                      {extracting === 'file' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {extracting === 'file' ? 'Reading receipt...' : 'Extract selected receipt'}
                    </Button>
                    {receiptFile && <Button type="button" variant="ghost" size="sm" onClick={() => changeReceiptFile(null)}>Remove selected file</Button>}
                    {extracting && <Button type="button" variant="ghost" size="sm" onClick={() => { cancelExtraction(); setReceiptSummary('Extraction cancelled. You can retry or enter the details manually.') }}>Cancel extraction</Button>}
                  </div>
                  <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
                    {receiptSummary || 'The receipt is attached to an expense only when you save.'}
                  </p>
                  {receiptFileResult && (
                    <div className="space-y-2 rounded border p-3">
                      <p className="text-xs text-muted-foreground">
                        Last receipt extraction confidence: {receiptFileResult.confidence}. {receiptFileResult.reason}
                      </p>
                      {receiptSourceFile !== receiptFile && <p className="text-xs text-amber-700 dark:text-amber-400">The attachment changed after extraction. These values came from the previous receipt. Extract the new receipt or review every field and confirm that the attachment belongs to this expense.</p>}
                      {(!formData.amount || !formData.expense_date || !formData.currency) && <p className="text-xs text-amber-700 dark:text-amber-400">Some details could not be confirmed. Fill the blank amount, date, or currency from the receipt.</p>}
                      {possibleReceiptDuplicate && <p className="text-xs text-amber-700 dark:text-amber-400" role="status">Possible duplicate: an existing expense has the same merchant, date, amount, and currency. Review your list before saving. This check may not identify all duplicates.</p>}
                      <label className="flex items-start gap-2 text-sm" htmlFor="receipt_reviewed">
                        <input id="receipt_reviewed" type="checkbox" checked={receiptReviewed} disabled={!!extracting} onChange={e => setReceiptReviewed(e.target.checked)} className="mt-1" />
                        <span>I reviewed the draft against my receipt and confirmed the details and any selected attachment.</span>
                      </label>
                    </div>
                  )}
                  <Label htmlFor="receipt_text">Or paste receipt text</Label>
                  <Textarea
                    id="receipt_text"
                    disabled={!!extracting}
                    value={receiptText}
                    onChange={(e) => {
                      setReceiptText(e.target.value)
                      setReceiptSummary(null)
                    }}
                    placeholder={'Example:\nSTARBUCKS\n04/27/2026\nLatte 5.49\nTax 0.45\nTotal $5.94'}
                    rows={4}
                  />
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground">Pasted text remains available for receipts you have already transcribed.</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleReceiptExtraction}
                      disabled={!!extracting || !receiptText.trim()}
                      className="shrink-0 gap-2"
                    >
                      <Upload className="h-4 w-4" />
                      Extract pasted receipt
                    </Button>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount *</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="99999999.99"
                    value={formData.amount}
                    disabled={!!extracting}
                    onChange={(e) => changeFormData({ amount: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Category *</Label>
                  <Select
                    disabled={!!extracting}
                    value={formData.category}
                    onValueChange={(value) => changeFormData({ category: value as ExpenseCategory })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(expenseCategoryLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="expense_currency">Currency *</Label>
                <Select name="expense_currency" value={formData.currency} required disabled={!!extracting} onValueChange={value => changeFormData({ currency: value })}>
                  <SelectTrigger id="expense_currency"><SelectValue placeholder="Choose the receipt currency" /></SelectTrigger>
                  <SelectContent>
                    {supportedReceiptCurrencies.map(currency => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="expense_date">Date *</Label>
                  <Input
                    id="expense_date"
                    type="date"
                    value={formData.expense_date}
                    disabled={!!extracting}
                    onChange={(e) => changeFormData({ expense_date: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="merchant">Merchant</Label>
                  <Input
                    id="merchant"
                    value={formData.merchant}
                    disabled={!!extracting}
                    onChange={(e) => changeFormData({ merchant: e.target.value })}
                    placeholder="e.g., Amazon, Uber"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="project">Project (optional)</Label>
                <Select
                  disabled={!!extracting}
                  value={formData.project_id}
                  onValueChange={(value) => changeFormData({ project_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  value={formData.description}
                  disabled={!!extracting}
                  onChange={(e) => changeFormData({ description: e.target.value })}
                  placeholder="Brief description of the expense"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  disabled={!!extracting}
                  onChange={(e) => changeFormData({ notes: e.target.value })}
                  rows={2}
                />
              </div>
            </fieldset>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={saving} onClick={() => { closeExpenseDialog(); if (createAttempt.unknown) void loadData() }}>
                {createAttempt.unknown ? 'Close and review list' : 'Cancel'}
              </Button>
              <Button type="submit" disabled={saving || !!extracting || (!createAttempt.unknown && !!receiptFileResult && !receiptReviewed)}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {createAttempt.unknown ? 'Retry original save' : selectedExpense ? 'Save Changes' : 'Add Expense'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Expense</AlertDialogTitle>
            <AlertDialogDescription>
              Archive this expense? Its record and history will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {historyId&&<RecordHistoryDialog kind="expenses" id={historyId} onClose={()=>setHistoryId(null)} />}
    </div>
  )
}
