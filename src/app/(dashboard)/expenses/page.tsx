'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { getExpenses, createExpense, updateExpense, deleteExpense, uploadReceipt, getReceiptUrl } from '@/services/expenses.service'
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
import { Plus, Receipt, Pencil, Trash2, Loader2, DollarSign, Wand2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { formatDateOnly, dateInputValue } from '@/lib/date-format'
import { captureExpenseFromText, captureReceiptDocumentFromText } from '@/lib/expense-ai'

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
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null)
  const [saving, setSaving] = useState(false)
  const [smartCaptureText, setSmartCaptureText] = useState('')
  const [smartCaptureSummary, setSmartCaptureSummary] = useState<string | null>(null)
  const [receiptText, setReceiptText] = useState('')
  const [receiptSummary, setReceiptSummary] = useState<string | null>(null)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)

  const [formData, setFormData] = useState({
    amount: '',
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
      console.error('Failed to load expenses:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to load data'
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const openCreateDialog = () => {
    setSelectedExpense(null)
    setFormData({
      amount: '',
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
    setSelectedExpense(expense)
    setFormData({
      amount: expense.amount.toString(),
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
    setSaving(true)

    try {
      const receiptPath = receiptFile ? await uploadReceipt(receiptFile) : selectedExpense?.receipt_path
      const expenseData = {
        user_id: user?.id!,
        amount: parseFloat(formData.amount),
        currency: 'USD',
        category: formData.category,
        description: formData.description || undefined,
        merchant: formData.merchant || undefined,
        expense_date: formData.expense_date,
        project_id: formData.project_id || undefined,
        notes: formData.notes || undefined,
        receipt_path: receiptPath || undefined,
        status: selectedExpense?.status ?? ExpenseStatus.draft,
      }

      if (selectedExpense) {
        await updateExpense(selectedExpense.id, expenseData)
        toast.success('Expense updated')
      } else {
        await createExpense(expenseData)
        toast.success('Expense created')
      }
      setDialogOpen(false)
      loadData()
    } catch (error) {
      console.error('Failed to save expense:', JSON.stringify(error, null, 2), error)
      toast.error(getErrorMessage(error, 'Failed to save expense'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedExpense) return

    try {
      await deleteExpense(selectedExpense.id)
      toast.success('Expense deleted')
      setDeleteDialogOpen(false)
      setSelectedExpense(null)
      loadData()
    } catch (error) {
      console.error('Failed to delete expense:', JSON.stringify(error, null, 2), error)
      toast.error(getErrorMessage(error, 'Failed to delete expense'))
    }
  }

  // Calculate total
  const totalAmount = expenses.reduce((sum, expense) => sum + expense.amount, 0)
  const handleSmartCapture = async () => {
    try {
      setSmartCaptureSummary('Asking Amountly AI...')
      const result = await captureExpenseFromText(smartCaptureText)
      const nextFormData = {
        ...formData,
        amount: result.amount ?? formData.amount,
        merchant: result.merchant ?? formData.merchant,
        description: result.description ?? formData.description,
        expense_date: result.expense_date ?? formData.expense_date,
        category: result.category,
      }

      setFormData(nextFormData)
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
      const message = getErrorMessage(error, 'AI capture failed')
      setSmartCaptureSummary(message)
      toast.error(message)
    }
  }
  const handleReceiptExtraction = async () => {
    try {
      setReceiptSummary('Asking Amountly AI...')
      const result = await captureReceiptDocumentFromText(receiptText)
      setFormData({
        ...formData,
        amount: result.amount ?? formData.amount,
        merchant: result.merchant ?? formData.merchant,
        description: result.description ?? formData.description,
        expense_date: result.expense_date ?? formData.expense_date,
        category: result.category,
        notes: result.notes ?? formData.notes,
      })
      setReceiptSummary(result.summary)
    } catch (error) {
      const message = getErrorMessage(error, 'Receipt extraction failed')
      setReceiptSummary(message)
      toast.error(message)
    }
  }

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
            <CardTitle className="text-sm font-medium">Total Amount</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalAmount.toFixed(2)}</div>
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
                      <span className="flex items-center justify-end gap-1">
                        <DollarSign className="w-3 h-3" />
                        {expense.amount.toFixed(2)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(expense.status)}>
                        {expenseStatusLabels[expense.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {(expense.receipt_path || expense.receipt_url) && <Button variant="ghost" size="sm" onClick={async () => {
                        try { const url = await getReceiptUrl(expense); window.open(url, '_blank', 'noopener,noreferrer') }
                        catch { toast.error('Could not open receipt. Check your access and try again.') }
                      }}>Receipt</Button>}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(expense)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
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
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedExpense ? 'Edit Expense' : 'Add Expense'}
            </DialogTitle>
            <DialogDescription>
              {selectedExpense ? 'Update expense details' : 'Record a new expense'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
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
                        disabled={!smartCaptureText.trim()}
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
                    <p className="text-sm font-medium">Receipt/document extraction</p>
                    <p className="text-sm text-muted-foreground">
                      Attach a receipt and paste receipt text or OCR output for Amountly to extract the fields.
                    </p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="receipt_file">Receipt file</Label>
                    <Input
                      id="receipt_file"
                      type="file"
                      accept="image/*,.pdf"
                      onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {receiptFile ? `${receiptFile.name} will be attached when you save.` : (selectedExpense?.receipt_path || selectedExpense?.receipt_url) ? 'Existing receipt will stay attached unless replaced.' : 'Optional image or PDF attachment.'}
                    </p>
                  </div>
                  <Textarea
                    value={receiptText}
                    onChange={(e) => {
                      setReceiptText(e.target.value)
                      setReceiptSummary(null)
                    }}
                    placeholder={'Example:\nSTARBUCKS\n04/27/2026\nLatte 5.49\nTax 0.45\nTotal $5.94'}
                    rows={4}
                  />
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground">
                      {receiptSummary || 'Amountly looks for merchant, date, total, and category signals.'}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleReceiptExtraction}
                      disabled={!receiptText.trim()}
                      className="shrink-0 gap-2"
                    >
                      <Upload className="h-4 w-4" />
                      Extract receipt
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
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Category *</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(value) => setFormData({ ...formData, category: value as ExpenseCategory })}
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
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="expense_date">Date *</Label>
                  <Input
                    id="expense_date"
                    type="date"
                    value={formData.expense_date}
                    onChange={(e) => setFormData({ ...formData, expense_date: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="merchant">Merchant</Label>
                  <Input
                    id="merchant"
                    value={formData.merchant}
                    onChange={(e) => setFormData({ ...formData, merchant: e.target.value })}
                    placeholder="e.g., Amazon, Uber"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="project">Project (optional)</Label>
                <Select
                  value={formData.project_id}
                  onValueChange={(value) => setFormData({ ...formData, project_id: value })}
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
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Brief description of the expense"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {selectedExpense ? 'Save Changes' : 'Add Expense'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Expense</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this expense? This action cannot be undone.
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
    </div>
  )
}
