'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { ReceiptDocument } from '@/components/ReceiptDocument'
import { CaptureDraftInbox } from '@/components/CaptureDraftInbox'
import { captureFieldsSchema, type CaptureDraft } from '@/lib/capture-drafts'
import { keepCapture, getCaptureFile, getCaptureDrafts, discardCapture } from '@/services/capture-drafts.service'
import { usesRenderBackend } from '@/lib/platform/config'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { getExpenses, createExpense, updateExpense, archiveExpense, uploadReceipt } from '@/services/expenses.service'
import { RecordSaveError, setExpenseReview } from '@/services/review.service'
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
import { captureReceiptDocumentFromText, captureReceiptFromFile } from '@/lib/expense-ai'
import { supportedReceiptCurrencies, type ReceiptFileCaptureResult } from '@/lib/ai/receipt-contract'
import { expenseTotalsByCurrency, findPossibleReceiptDuplicate, isSupportedReceiptCurrency, receiptDraftIsComplete, receiptExpenseFields } from '@/lib/receipt-review'
import { expenseNavigation, expenseFilterHref, expenseNeedsReview, filterExpenseList, validExpenseFilterDate } from '@/lib/expense-navigation'

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
  const { user } = useAuth()
  // A new ownership boundary gets a fresh editor, including uncertain saves.
  return <ExpensesWorkspace key={`${user?.id ?? 'signed-out'}:${user?.organization_id ?? ''}:${user?.account_type ?? ''}:${user?.role ?? ''}`} />
}

function ExpensesWorkspace() {
  const formatDateOnly = useDisplayDate()
  const { user } = useAuth()
  const router = useRouter()
  const queryString = useSearchParams()?.toString() ?? ''
  const navigation = expenseNavigation(new URLSearchParams(queryString))
  const isSolo = user?.account_type === 'freelancer'
  const [search, setSearch] = useState(navigation.filters.query)
  const [startDate, setStartDate] = useState(navigation.filters.start)
  const [endDate, setEndDate] = useState(navigation.filters.end)
  const [categoryFilter, setCategoryFilter] = useState(navigation.filters.category)
  const [statusFilter, setStatusFilter] = useState(navigation.status)
  const [reviewFilter, setReviewFilter] = useState(navigation.filters.review)
  const [linkError, setLinkError] = useState<string | null>(null)
  const handledLink = useRef<string | null>(null)
  const receiptInput = useRef<HTMLInputElement>(null)
  const focusReceipt = useRef(false)
  const loadVersion = useRef(0)
  const loadedScope = useRef<string | null>(null)
  const mounted = useRef(true)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Expense | null>(null)
  const [reviewTarget, setReviewTarget] = useState<{ expense: Expense; reviewed: boolean } | null>(null)
  const [reviewSaving, setReviewSaving] = useState(false)
  const reviewOperation = useRef(false)
  const [historyId,setHistoryId]=useState<string|null>(null)
  const [saving, setSaving] = useState(false)
  const [receiptText, setReceiptText] = useState('')
  const [receiptSummary, setReceiptSummary] = useState<string | null>(null)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptFileInputKey, setReceiptFileInputKey] = useState(0)
  const [captureMethod, setCaptureMethod] = useState<'file'|'text'|'manual'>('file')
  const [captureExtracted, setCaptureExtracted] = useState(false)
  const [activeCapture, setActiveCapture] = useState<{id:string;revision:number}|null>(null)
  const [captureBusy, setCaptureBusy] = useState(false)
  const captureOperation = useRef(false)
  const [captureVersion, setCaptureVersion] = useState(0)
  const [detailsOpen, setDetailsOpen] = useState(false)
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

  // Establish liveness before starting data loads, including StrictMode replay.
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; loadVersion.current++; extraction.current.controller?.abort() }
  }, [])

  useEffect(() => {
    loadedScope.current = null
    setExpenses([])
    setProjects([])
    setDialogOpen(false)
    setActiveCapture(null);setReceiptFile(null);setReceiptFileResult(null);setReceiptSourceFile(null);setReceiptText('');setReceiptReviewed(false);setCaptureExtracted(false)
    setFormData({amount:'',currency:'USD',category:ExpenseCategory.other,description:'',merchant:'',expense_date:format(new Date(),'yyyy-MM-dd'),project_id:'',notes:''})
    cancelExtraction()
    setLoading(true)
    if (user) void loadData()
    return () => { loadVersion.current++ }
  }, [user?.id, user?.organization_id])

  useEffect(() => {
    setStatusFilter(navigation.status); setSearch(navigation.filters.query)
    setStartDate(navigation.filters.start); setEndDate(navigation.filters.end)
    setCategoryFilter(navigation.filters.category); setReviewFilter(navigation.filters.review)
  }, [queryString])
  const updateFilters = (patch: Partial<Parameters<typeof expenseFilterHref>[0]>) => {
    const next={query:search,start:startDate,end:endDate,category:categoryFilter,status:statusFilter,review:reviewFilter,...patch}
    const href=expenseFilterHref(next)
    if(navigation.returnTo!=='/expenses') router.replace(href+(href.includes('?')?'&':'?')+'returnTo='+encodeURIComponent(navigation.returnTo),{scroll:false})
    else router.replace(href,{scroll:false})
  }

  const loadData = async () => {
    if (!mounted.current) return
    const version = ++loadVersion.current
    const scope = user ? `${user.id}:${user.organization_id ?? ''}` : null
    if (!scope) return
    try {
      setError(null)
      const [expensesData, projectsData] = await Promise.all([
        getExpenses(),
        getProjects({
          userId: user?.id,
          organizationId: user?.organization_id,
        }),
      ])
      if (version !== loadVersion.current) return
      loadedScope.current = scope
      setExpenses(expensesData)
      setProjects(projectsData)
    } catch (err) {
      if (version !== loadVersion.current) return
      const errorMessage = err instanceof Error ? err.message : 'Failed to load data'
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      if (version === loadVersion.current) setLoading(false)
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
    setCaptureExtracted(false)
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
    focusReceipt.current = false
    setDialogOpen(false)
  }
  const beginExtraction = (kind: NonNullable<typeof extracting>) => {
    if (extraction.current.controller || saving || captureOperation.current || createAttempt.unknown) return null
    const current = { version: extraction.current.version + 1, controller: new AbortController() }
    extraction.current = current
    setExtracting(kind)
    return current
  }
  const readOnlyExpense = !!selectedExpense && (selectedExpense.user_id !== user?.id || !['DRAFT', 'REJECTED'].includes(selectedExpense.status))
  const selectedExpenseDirty = !!selectedExpense && !readOnlyExpense && (!!receiptFile
    || Number(formData.amount) !== selectedExpense.amount || formData.currency !== selectedExpense.currency
    || formData.category !== selectedExpense.category || formData.merchant !== (selectedExpense.merchant ?? '')
    || formData.description !== (selectedExpense.description ?? '') || formData.notes !== (selectedExpense.notes ?? '')
    || formData.project_id !== (selectedExpense.project_id ?? '') || formData.expense_date !== dateInputValue(selectedExpense.expense_date))
  const canReviewSavedExpense = (expense: Expense) => isSolo && !user?.organization_id && user?.is_active !== false
    && expense.user_id === user?.id && !expense.archived_at && ['DRAFT', 'REJECTED'].includes(expense.status)
  const reviewActionDisabled = saving || reviewSaving || createAttempt.unknown || !!extracting || (dialogOpen && selectedExpenseDirty)
  const extractionIsCurrent = (current: { version: number; controller: AbortController }) =>
    extraction.current.version === current.version && !current.controller.signal.aborted
  const finishExtraction = (current: { version: number; controller: AbortController }) => {
    if (extractionIsCurrent(current)) {
      extraction.current.controller = null
      setExtracting(null)
    }
  }

  const openCreateDialog = () => {
    if (reviewOperation.current || saving || captureOperation.current) return
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
    setActiveCapture(null)
    setCaptureMethod('file')
    setDetailsOpen(false)
    setReceiptText('')
    setReceiptSummary(null)
    setReceiptFile(null)
    setDialogOpen(true)
  }

  const openEditDialog = (expense: Expense) => {
    if (reviewOperation.current || saving || captureOperation.current) return
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
    setActiveCapture(null)
    setCaptureMethod('manual')
    setDetailsOpen(false)
    setReceiptText('')
    setReceiptSummary(null)
    setReceiptFile(null)
    setDialogOpen(true)
  }

  const resumeCapture = async (draft: CaptureDraft) => {
    if (saving || reviewSaving || captureOperation.current || dialogOpen || createAttempt.unknown) {
      toast.error('Finish or close the current expense before resuming a capture.'); return
    }
    if (expenses.some(row=>row.id===draft.id)) {
      toast.message('This capture already has a saved expense. Open that expense to review it.'); return
    }
    const scope=`${user?.id}:${user?.organization_id??''}`
    captureOperation.current=true;setCaptureBusy(true)
    try {
      const file=await getCaptureFile(draft)
      if(!mounted.current || loadedScope.current!==scope)return
      resetReceiptReview();uploadedReceipt.current=null;setSelectedExpense(null)
      setActiveCapture({id:draft.id,revision:draft.revision})
      setFormData(draft.payload.fields);setReceiptText(draft.payload.text)
      setCaptureMethod(draft.payload.method);setReceiptFile(file)
      setReceiptFileResult(draft.payload.extraction);setReceiptSourceFile(file)
      setCaptureExtracted(draft.payload.extracted);setReceiptReviewed(false)
      setReceiptSummary(draft.payload.extracted?'Restored proposal. Check its fields and original again before saving.':null)
      setDetailsOpen(!!draft.payload.fields.project_id||!!draft.payload.fields.notes)
      setDialogOpen(true)
    } catch(failure){if(mounted.current&&loadedScope.current===scope)toast.error(getErrorMessage(failure,'Could not resume capture.'))}
    finally{captureOperation.current=false;if(mounted.current)setCaptureBusy(false)}
  }
  const keepForLater = async () => {
    if(selectedExpense || saving || reviewSaving || extracting || captureOperation.current || createAttempt.unknown)return
    const scope=`${user?.id}:${user?.organization_id??''}`
    const capture=activeCapture??{id:crypto.randomUUID(),revision:0}
    setActiveCapture(capture);captureOperation.current=true;setCaptureBusy(true)
    try {
      const draft=await keepCapture({...capture,payload:{method:captureMethod,fields:captureFieldsSchema.parse(formData),text:receiptText,
        extraction:receiptSourceFile===receiptFile?receiptFileResult:null,
        extracted:captureExtracted || !!receiptFileResult}},receiptFile)
      if(!mounted.current||loadedScope.current!==scope)return
      setActiveCapture({id:draft.id,revision:draft.revision});setCaptureVersion(v=>v+1)
      closeExpenseDialog();toast.success('Capture kept privately. No expense was recorded.')
    } catch(failure){if(mounted.current&&loadedScope.current===scope)toast.error(getErrorMessage(failure,'Could not keep capture.'))}
    finally{captureOperation.current=false;if(mounted.current)setCaptureBusy(false)}
  }

  useEffect(() => {
    if (loading || error || !user || loadedScope.current !== `${user.id}:${user.organization_id ?? ''}`) return
    const key = `${user.id}:${queryString}`
    if (handledLink.current === key) return
    handledLink.current = key
    if (navigation.invalid) {
      setLinkError('This expense link is invalid. Choose an expense from the list.')
      return
    }
    if (navigation.captureId) {
      void getCaptureDrafts().then(drafts=>{const draft=drafts.find(d=>d.id===navigation.captureId);if(draft)void resumeCapture(draft);else setLinkError('This capture is unavailable. Choose one from the inbox.')}).catch(()=>setLinkError('Could not open this capture. Try again.'))
    }
    if (navigation.expenseId || navigation.uploadReceipt) {
      setLinkError(null)
      // Navigation cannot replace an in-flight or uncertain save.
      if (saving || reviewSaving || createAttempt.unknown || dialogOpen) {
        setLinkError('Finish or close the current expense before opening another.')
      } else if (navigation.uploadReceipt) {
        focusReceipt.current = true
        openCreateDialog()
      } else {
        const expense = expenses.find(row => row.id.toLowerCase() === navigation.expenseId)
        if (expense) openEditDialog(expense)
        else setLinkError('This expense is unavailable. Choose an expense from the list.')
      }
      const params = new URLSearchParams(queryString)
      params.delete('expense')
      params.delete('action')
      router.replace('/expenses'+(params.size?'?'+params.toString():''), { scroll: false })
    }
  }, [queryString, loading, error, user?.id, user?.organization_id, expenses])

  const requestExpenseReview = (expense: Expense) => {
    if (!canReviewSavedExpense(expense) || reviewActionDisabled || reviewOperation.current
      || (dialogOpen && selectedExpense?.id !== expense.id)) return
    setReviewTarget({ expense, reviewed: !expense.reviewed_at })
  }
  const confirmExpenseReview = async () => {
    if (!reviewTarget || !mounted.current || reviewOperation.current || reviewActionDisabled
      || !canReviewSavedExpense(reviewTarget.expense)) return
    const target = reviewTarget
    reviewOperation.current = true
    setReviewSaving(true)
    try {
      await setExpenseReview(target.expense.id, target.reviewed, target.expense.updated_at)
      if (!mounted.current) return
      setReviewTarget(null)
      closeExpenseDialog()
      await loadData()
      if (mounted.current) toast.success(target.reviewed ? 'Expense marked reviewed' : 'Expense review cleared')
    } catch (failure) {
      if (!mounted.current) return
      setReviewTarget(null)
      // Reload before another attempt; never attach a new version to stale form input.
      closeExpenseDialog()
      await loadData()
      if (mounted.current) toast.error(failure instanceof RecordSaveError ? failure.message : 'Could not confirm the review. Reload and check the current expense before trying again.')
    } finally {
      reviewOperation.current = false
      if (mounted.current) setReviewSaving(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving || reviewOperation.current || readOnlyExpense || extraction.current.controller || captureOperation.current) return
    if (!createAttempt.unknown && (receiptFileResult || captureExtracted) && !receiptReviewed) {
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
      if (!mounted.current) return
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
        if (!mounted.current) return
        toast.success('Expense updated')
      } else {
        await createAttempt.run(expenseData, (input,id)=>createExpense(input,activeCapture?.id??id))
        if (!mounted.current) return
        toast.success('Expense created')
      }
      if(activeCapture){
        try{await discardCapture(activeCapture.id,activeCapture.revision)}
        catch{toast.message('Expense saved. Its kept capture could not be removed; reopening it will not create a second expense.')}
        setCaptureVersion(v=>v+1)
      }
      closeExpenseDialog()
      loadData()
    } catch (error) {
      if (!mounted.current) return
      toast.error(error instanceof Error ? error.message : 'Could not confirm the save. Review the expense before trying again.')
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!archiveTarget || reviewOperation.current) return

    try {
      await archiveExpense(archiveTarget.id, archiveTarget.updated_at)
      if (!mounted.current) return
      toast.success('Expense archived; history preserved')
      setDeleteDialogOpen(false)
      setArchiveTarget(null)
      loadData()
    } catch (error) {
      if (!mounted.current) return
      toast.error(getErrorMessage(error, 'Failed to delete expense'))
    }
  }

  const currencyTotals = expenseTotalsByCurrency(expenses)
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
      setCaptureExtracted(true)
      setReceiptFileResult(null);setReceiptSourceFile(null)
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
      setCaptureExtracted(true)
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
  const filteredExpenses = navigation.invalid ? [] : filterExpenseList(expenses, { query: search, start: startDate, end: endDate, category: categoryFilter, status: statusFilter, review: isSolo ? reviewFilter : 'all' })
  const invalidDateRange = (!!startDate && !validExpenseFilterDate(startDate)) || (!!endDate && !validExpenseFilterDate(endDate)) || (!!startDate && !!endDate && startDate > endDate)
  const clearFilters = () => { setSearch(''); setStartDate(''); setEndDate(''); setCategoryFilter('all'); setStatusFilter('all'); setReviewFilter('all'); setLinkError(null); router.replace('/expenses', { scroll: false }) }

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
      <div className="flex flex-wrap gap-3 justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Expenses</h1>
          <p className="text-muted-foreground">Track and manage your expenses</p>
        </div>
        <Button onClick={openCreateDialog} disabled={reviewSaving} className="gap-2">
          <Plus className="w-4 h-4" />
          Add Expense
        </Button>
      </div>

      {/* Summary Cards */}
      {linkError && <p className="text-sm text-destructive" role="alert">{linkError}</p>}
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
            <CardTitle className="text-sm font-medium">{isSolo ? 'Needs review' : 'Pending'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {expenses.filter(e => isSolo ? e.user_id === user?.id && expenseNeedsReview(e) : e.status === ExpenseStatus.submitted).length}
            </div>
            {isSolo && <p className="mt-1 text-sm text-muted-foreground">Saved draft and rejected expenses</p>}
          </CardContent>
        </Card>
      </div>

      {navigation.returnTo!=='/expenses'&&<Link href={navigation.returnTo} className="text-sm underline">Back to results</Link>}
      <CaptureDraftInbox onResume={draft=>void resumeCapture(draft)} refreshKey={captureVersion}/>
      <Card>
        <CardHeader><CardTitle className="text-base">Find expenses</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className={`grid gap-3 sm:grid-cols-2 ${isSolo ? 'lg:grid-cols-3 xl:grid-cols-6' : 'lg:grid-cols-5'}`}>
            <div className="space-y-1"><Label htmlFor="expense_search">Merchant or description</Label><Input id="expense_search" maxLength={100} value={search} onChange={e => updateFilters({query:e.target.value.slice(0,100)})} placeholder="Search expenses" /></div>
            <div className="space-y-1"><Label htmlFor="expense_start">From</Label><Input id="expense_start" type="date" value={startDate} onChange={e => updateFilters({start:e.target.value})} /></div>
            <div className="space-y-1"><Label htmlFor="expense_end">Through</Label><Input id="expense_end" type="date" value={endDate} onChange={e => updateFilters({end:e.target.value})} /></div>
            <div className="space-y-1"><Label htmlFor="expense_category_filter">Category</Label><Select value={categoryFilter} onValueChange={value=>updateFilters({category:value})}><SelectTrigger id="expense_category_filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{Object.entries(expenseCategoryLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label htmlFor="expense_status_filter">Status</Label><Select value={statusFilter} onValueChange={value=>updateFilters({status:value})}><SelectTrigger id="expense_status_filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{Object.entries(expenseStatusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
            {isSolo && <div className="space-y-1"><Label htmlFor="expense_review_filter">Review</Label><Select value={reviewFilter} onValueChange={value=>updateFilters({review:value})}><SelectTrigger id="expense_review_filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All review states</SelectItem><SelectItem value="needs-review">Needs review</SelectItem><SelectItem value="reviewed">Reviewed</SelectItem></SelectContent></Select></div>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted-foreground" role="status">Showing {filteredExpenses.length} of {expenses.length} expenses. Summary totals include all expenses.</p><Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button></div>
          {invalidDateRange && <p className="text-sm text-destructive" role="alert">Choose valid dates with the end on or after the start.</p>}
        </CardContent>
      </Card>

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
              Expenses
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
                {filteredExpenses.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No expenses match these filters.</TableCell></TableRow>}
                {filteredExpenses.map((expense) => (
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
                      {isSolo && (expense.reviewed_at || ['DRAFT', 'REJECTED'].includes(expense.status)) && <Badge variant={expense.reviewed_at ? 'secondary' : 'outline'} className="ml-1">{expense.reviewed_at ? 'Reviewed' : 'Needs review'}</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={()=>setHistoryId(expense.id)}>History</Button>
                      {(expense.receipt_path || expense.receipt_url) && <Button variant="ghost" size="sm" onClick={()=>openEditDialog(expense)}>Receipt</Button>}
                      {canReviewSavedExpense(expense) && <Button variant="outline" size="sm" disabled={reviewActionDisabled} onClick={() => requestExpenseReview(expense)}>{expense.reviewed_at ? 'Clear review' : 'Mark reviewed'}</Button>}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(expense)}
                        aria-label="Edit expense"
                        disabled={reviewSaving || expense.user_id !== user?.id || !['DRAFT','REJECTED'].includes(expense.status)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Archive expense"
                        disabled={reviewSaving || expense.user_id !== user?.id || !['DRAFT','REJECTED'].includes(expense.status)}
                        onClick={() => {
                          setArchiveTarget(expense)
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
      <Dialog open={dialogOpen} onOpenChange={open => { if (!saving && !reviewSaving) { if (open) setDialogOpen(true); else closeExpenseDialog() } }}>
        <DialogContent className="sm:max-w-5xl max-h-[90dvh] overflow-y-auto" onOpenAutoFocus={event => {
          if (focusReceipt.current && receiptInput.current) {
            event.preventDefault()
            focusReceipt.current = false
            receiptInput.current.focus()
          }
        }}>
          <DialogHeader>
            <DialogTitle>
              {selectedExpense ? readOnlyExpense ? 'Expense details' : 'Edit Expense' : 'Add Expense'}
            </DialogTitle>
            <DialogDescription>
              {selectedExpense ? readOnlyExpense ? 'View the recorded expense. This record cannot be edited.' : 'Update expense details' : 'Record a new expense'}
            </DialogDescription>
          </DialogHeader>
          <div className={`grid min-w-0 gap-5 ${receiptFile || selectedExpense?.receipt_path || selectedExpense?.receipt_url ? 'lg:grid-cols-2' : ''}`}>
            {receiptFile ? <ReceiptDocument source={{file:receiptFile}}/> : selectedExpense&&(selectedExpense.receipt_path||selectedExpense.receipt_url)?<ReceiptDocument source={{expense:selectedExpense}}/>:null}
          <form onSubmit={handleSubmit} className="min-w-0">
            <SaveAttemptNotice message={createAttempt.message} />
            {isSolo && selectedExpense && (selectedExpense.reviewed_at || ['DRAFT', 'REJECTED'].includes(selectedExpense.status)) && <div className="mt-3 space-y-2 rounded border p-3">
              <Badge variant={selectedExpense.reviewed_at ? 'secondary' : 'outline'}>{selectedExpense.reviewed_at ? 'Reviewed' : 'Needs review'}</Badge>
              {canReviewSavedExpense(selectedExpense) && <Button type="button" variant="outline" className="ml-2" disabled={reviewActionDisabled} onClick={() => requestExpenseReview(selectedExpense)}>{selectedExpense.reviewed_at ? 'Clear review' : 'Mark reviewed'}</Button>}
              <p className="text-sm text-muted-foreground">{selectedExpenseDirty ? 'Save your changes before reviewing this expense.' : 'Review the saved details and receipt. Changes to the expense require another review.'}</p>
            </div>}
            <fieldset disabled={saving || reviewSaving || captureBusy || createAttempt.unknown || readOnlyExpense} className="grid gap-4 py-4">
              {!readOnlyExpense && <>
                <div className="flex flex-wrap gap-2" aria-label="Capture method">
                  {([['file','Receipt file'],['text','Paste text'],['manual','Manual entry']] as const).map(([method,label])=><Button key={method} type="button" variant={captureMethod===method?'default':'outline'} aria-pressed={captureMethod===method} disabled={!!extracting} onClick={()=>{setCaptureMethod(method);setReceiptReviewed(false)}}>{label}</Button>)}
                </div>
                {captureMethod==='file'&&<div className="space-y-3 rounded-xl border bg-muted/20 p-3">
                  <Label htmlFor="receipt_file">Receipt file</Label>
                  <Input key={receiptFileInputKey} ref={receiptInput} id="receipt_file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={!!extracting} onChange={e=>changeReceiptFile(e.target.files?.[0]??null)}/>
                  <p className="text-xs text-muted-foreground">{receiptFile?`${receiptFile.name} selected.`:'One JPEG, PNG, WebP or PDF, up to 10 MB and 5 PDF pages.'}</p>
                  <p className="text-xs text-muted-foreground">Extracting sends this receipt to OpenAI. Review the proposal before saving. AI can make mistakes.</p>
                  <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!receiptFile||!!extracting} onClick={handleReceiptFileExtraction}>{extracting==='file'?'Reading receipt…':'Extract selected receipt'}</Button>{receiptFile&&<Button type="button" variant="ghost" disabled={!!extracting} onClick={()=>changeReceiptFile(null)}>Remove selected file</Button>}</div>
                  <p className="text-xs text-muted-foreground">Have an unpaid supplier invoice? <Link href="/bills" className="underline">Enter a supplier bill</Link>.</p>
                </div>}
                {captureMethod==='text'&&<div className="space-y-3 rounded-xl border p-3"><Label htmlFor="receipt_text">Receipt text</Label><Textarea id="receipt_text" maxLength={12000} value={receiptText} disabled={!!extracting} onChange={e=>{setReceiptText(e.target.value);setReceiptReviewed(false);setReceiptSummary(null)}} rows={4} placeholder="Paste the receipt details"/><p className="text-xs text-muted-foreground">Extraction sends this text to OpenAI. Check the proposed fields before saving.</p><Button type="button" variant="outline" disabled={!!extracting||!receiptText.trim()} onClick={handleReceiptExtraction}>Extract pasted receipt</Button></div>}
                {extracting&&<Button type="button" variant="ghost" onClick={()=>{cancelExtraction();setReceiptSummary('Extraction cancelled. Retry or enter the details manually.')}}>Cancel extraction</Button>}
                {receiptSummary&&<p className="text-sm" role="status">{receiptSummary}</p>}
                {receiptFileResult&&<div className="space-y-2 rounded border p-3"><p className="text-xs text-muted-foreground">Extraction confidence: {receiptFileResult.confidence}. {receiptFileResult.reason}</p>{receiptSourceFile!==receiptFile&&<p className="text-sm text-amber-700">The original changed after extraction. Extract again or confirm every field against the selected receipt.</p>}{(!formData.amount||!formData.expense_date||!formData.currency)&&<p className="text-sm text-amber-700">Confirm the missing amount, date or currency from the original.</p>}{possibleReceiptDuplicate&&<p role="status" className="text-sm text-amber-700">Possible duplicate: a loaded expense has the same merchant, date, amount and currency. Check your records before saving.</p>}</div>}
                {(receiptFileResult||captureExtracted)&&<label className="flex items-start gap-2 text-sm" htmlFor="receipt_reviewed"><input id="receipt_reviewed" type="checkbox" checked={receiptReviewed} disabled={!!extracting} onChange={e=>setReceiptReviewed(e.target.checked)} className="mt-1"/><span>I reviewed the draft against my receipt and confirmed the details and any selected attachment.</span></label>}
              </>}
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
                    <SelectTrigger id="category">
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
              <Button type="button" variant="ghost" className="justify-start" aria-expanded={detailsOpen} onClick={()=>setDetailsOpen(v=>!v)}>Add details {detailsOpen?'−':'+'}</Button>
              {(detailsOpen||readOnlyExpense)&&<div className="grid gap-4">              <div className="space-y-2">
                <Label htmlFor="project">Project (optional)</Label>
                <Select
                  disabled={!!extracting}
                  value={formData.project_id}
                  onValueChange={(value) => changeFormData({ project_id: value })}
                >
                  <SelectTrigger id="project">
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
</div>}
            </fieldset>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={saving || reviewSaving || captureBusy} onClick={() => { closeExpenseDialog(); if (createAttempt.unknown) void loadData() }}>
                {readOnlyExpense ? 'Close' : createAttempt.unknown ? 'Close and review list' : 'Cancel'}
              </Button>
              {!selectedExpense&&usesRenderBackend&&<Button type="button" variant="outline" disabled={saving||reviewSaving||captureBusy||!!extracting||createAttempt.unknown} onClick={()=>void keepForLater()}>{captureBusy?'Keeping…':'Keep for later'}</Button>}
              {!readOnlyExpense && <Button type="submit" disabled={saving || reviewSaving || captureBusy || !!extracting || (!createAttempt.unknown && !!(receiptFileResult || captureExtracted) && !receiptReviewed)}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {createAttempt.unknown ? 'Retry original save' : selectedExpense ? 'Save Changes' : 'Add Expense'}
              </Button>}
            </DialogFooter>
            {!selectedExpense&&<p className="mt-3 text-xs text-muted-foreground">Keep for later stores this draft and any selected original privately in Amountly. It does not call AI or record an expense.</p>}
          </form></div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!reviewTarget} onOpenChange={open => { if (!open && !reviewOperation.current) setReviewTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{reviewTarget?.reviewed ? 'Mark expense reviewed?' : 'Clear expense review?'}</AlertDialogTitle>
            <AlertDialogDescription>{reviewTarget?.reviewed ? 'Confirm that you checked the saved amount, currency, date, category and receipt. The review will be recorded in its history.' : 'Clear the reviewed label so this saved expense needs review again. The change will be recorded in its history.'}</AlertDialogDescription>
          </AlertDialogHeader>
          {reviewTarget && <p className="text-sm">{reviewTarget.expense.merchant || reviewTarget.expense.description || 'Expense'} · {formatExpenseAmount(reviewTarget.expense.amount, reviewTarget.expense.currency)}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reviewSaving}>Cancel</AlertDialogCancel>
            <Button type="button" disabled={reviewSaving} onClick={confirmExpenseReview}>{reviewSaving ? 'Saving…' : reviewTarget?.reviewed ? 'Confirm mark reviewed' : 'Confirm clear review'}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={open => { setDeleteDialogOpen(open); if (!open) setArchiveTarget(null) }}>
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
