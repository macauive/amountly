'use client'

import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
  Plus,
  Pencil,
  Trash2,
  PlayCircle,
  Eye,
  Users,
  DollarSign,
  TrendingUp,
  AlertCircle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { useAppState } from '@/contexts/AppStateContext'
import { Capability, PayFrequency, PayrollStatus, payFrequencyLabels, payrollStatusLabels } from '@/types/enums'
import { DeferredModuleNotice } from '@/components/DeferredModuleNotice'
import { showAdvancedModules } from '@/lib/product-scope'
import type { Employee, PayrollRun, PayStub } from '@/types/models'
import {
  getEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  getPayrollRuns,
  createPayrollRun,
  deletePayrollRun,
  processPayrollRun,
  calculatePayStubAmounts,
  PAY_PERIODS_PER_YEAR,
} from '@/services/payroll.service'

// ─── Helpers ─────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

function statusBadge(status: PayrollStatus) {
  const variants: Record<PayrollStatus, string> = {
    [PayrollStatus.draft]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    [PayrollStatus.processing]: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    [PayrollStatus.completed]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    [PayrollStatus.failed]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  }
  return (
    <Badge className={variants[status]}>
      {payrollStatusLabels[status]}
    </Badge>
  )
}

// ─── Employee Dialog ──────────────────────────────────────────

interface EmployeeDialogProps {
  open: boolean
  employee: Employee | null
  orgId: string
  userId: string
  onClose: () => void
  onSave: (emp: Employee) => void
}

function EmployeeDialog({ open, employee, orgId, userId, onClose, onSave }: EmployeeDialogProps) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    title: '',
    department: '',
    hire_date: new Date().toISOString().split('T')[0],
    salary: '',
    pay_frequency: PayFrequency.biweekly as PayFrequency,
    tax_filing_status: 'single',
    federal_allowances: '0',
    state_allowances: '0',
    is_active: true,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (employee) {
      setForm({
        name: employee.name,
        email: employee.email,
        title: employee.title || '',
        department: employee.department || '',
        hire_date: employee.hire_date,
        salary: employee.salary.toString(),
        pay_frequency: employee.pay_frequency,
        tax_filing_status: employee.tax_filing_status || 'single',
        federal_allowances: employee.federal_allowances.toString(),
        state_allowances: employee.state_allowances.toString(),
        is_active: employee.is_active,
      })
    } else {
      setForm({
        name: '',
        email: '',
        title: '',
        department: '',
        hire_date: new Date().toISOString().split('T')[0],
        salary: '',
        pay_frequency: PayFrequency.biweekly,
        tax_filing_status: 'single',
        federal_allowances: '0',
        state_allowances: '0',
        is_active: true,
      })
    }
  }, [employee, open])

  const set = (key: string, val: string | boolean | PayFrequency) =>
    setForm((f) => ({ ...f, [key]: val }))

  const handleSave = async () => {
    if (!form.name || !form.email || !form.salary) {
      toast.error('Name, email, and salary are required')
      return
    }
    setSaving(true)
    try {
      const input = {
        organization_id: orgId,
        user_id: userId,
        name: form.name,
        email: form.email,
        title: form.title || undefined,
        department: form.department || undefined,
        hire_date: form.hire_date,
        salary: parseFloat(form.salary),
        pay_frequency: form.pay_frequency,
        tax_filing_status: form.tax_filing_status,
        federal_allowances: parseInt(form.federal_allowances) || 0,
        state_allowances: parseInt(form.state_allowances) || 0,
        is_active: form.is_active,
      }
      let saved: Employee
      if (employee) {
        saved = await updateEmployee(employee.id, input)
        toast.success('Employee updated')
      } else {
        saved = await createEmployee(input)
        toast.success('Employee added')
      }
      onSave(saved)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save employee')
    } finally {
      setSaving(false)
    }
  }

  // Preview calculated pay
  const previewCalc = form.salary
    ? calculatePayStubAmounts({
        salary: parseFloat(form.salary) || 0,
        pay_frequency: form.pay_frequency,
        federal_allowances: parseInt(form.federal_allowances) || 0,
        state_allowances: parseInt(form.state_allowances) || 0,
      } as Employee)
    : null

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{employee ? 'Edit Employee' : 'Add Employee'}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2 col-span-2">
            <Label>Full Name *</Label>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Jane Smith" />
          </div>
          <div className="space-y-2">
            <Label>Email *</Label>
            <Input value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="jane@company.com" type="email" />
          </div>
          <div className="space-y-2">
            <Label>Job Title</Label>
            <Input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Software Engineer" />
          </div>
          <div className="space-y-2">
            <Label>Department</Label>
            <Input value={form.department} onChange={(e) => set('department', e.target.value)} placeholder="Engineering" />
          </div>
          <div className="space-y-2">
            <Label>Hire Date</Label>
            <Input type="date" value={form.hire_date} onChange={(e) => set('hire_date', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Annual Salary (USD) *</Label>
            <Input
              type="number"
              min="0"
              step="1000"
              value={form.salary}
              onChange={(e) => set('salary', e.target.value)}
              placeholder="75000"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Pay Frequency</Label>
            <Select value={form.pay_frequency} onValueChange={(v) => set('pay_frequency', v as PayFrequency)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.values(PayFrequency).map((f) => (
                  <SelectItem key={f} value={f}>{payFrequencyLabels[f]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Tax Filing Status</Label>
            <Select value={form.tax_filing_status} onValueChange={(v) => set('tax_filing_status', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single</SelectItem>
                <SelectItem value="married">Married Filing Jointly</SelectItem>
                <SelectItem value="married_separately">Married Filing Separately</SelectItem>
                <SelectItem value="head_of_household">Head of Household</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Federal Allowances (W-4)</Label>
            <Input
              type="number"
              min="0"
              value={form.federal_allowances}
              onChange={(e) => set('federal_allowances', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>State Allowances</Label>
            <Input
              type="number"
              min="0"
              value={form.state_allowances}
              onChange={(e) => set('state_allowances', e.target.value)}
            />
          </div>
          <div className="space-y-2 col-span-2">
            <Label>Status</Label>
            <Select value={form.is_active ? 'active' : 'inactive'} onValueChange={(v) => set('is_active', v === 'active')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive / Terminated</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {previewCalc && (
          <div className="mt-4 rounded-lg border bg-muted/30 p-4 space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Estimated Per-Period Pay</p>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <p className="text-muted-foreground">Gross</p>
                <p className="font-semibold">{fmt(previewCalc.gross_pay)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Deductions</p>
                <p className="font-semibold text-red-600">
                  -{fmt(previewCalc.federal_tax + previewCalc.state_tax + previewCalc.social_security + previewCalc.medicare)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Net Pay</p>
                <p className="font-semibold text-green-600">{fmt(previewCalc.net_pay)}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Federal: {fmt(previewCalc.federal_tax)} · State (5%): {fmt(previewCalc.state_tax)} · SS: {fmt(previewCalc.social_security)} · Medicare: {fmt(previewCalc.medicare)}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : employee ? 'Save Changes' : 'Add Employee'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── New Payroll Run Dialog ───────────────────────────────────

interface NewRunDialogProps {
  open: boolean
  employees: Employee[]
  orgId: string
  userId: string
  onClose: () => void
  onCreated: (run: PayrollRun) => void
}

function NewRunDialog({ open, employees, orgId, userId, onClose, onCreated }: NewRunDialogProps) {
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({
    pay_period_start: today,
    pay_period_end: today,
    pay_date: today,
    notes: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm({ pay_period_start: today, pay_period_end: today, pay_date: today, notes: '' })
    }
  }, [open])

  const activeCount = employees.filter((e) => e.is_active).length

  const handleRun = async () => {
    if (!form.pay_period_start || !form.pay_period_end || !form.pay_date) {
      toast.error('All date fields are required')
      return
    }
    if (activeCount === 0) {
      toast.error('No active employees to pay')
      return
    }
    setSaving(true)
    try {
      const run = await createPayrollRun(
        {
          organization_id: orgId,
          pay_period_start: form.pay_period_start,
          pay_period_end: form.pay_period_end,
          pay_date: form.pay_date,
          status: PayrollStatus.draft,
          total_gross: 0,
          total_deductions: 0,
          total_net: 0,
          total_employer_taxes: 0,
          notes: form.notes || undefined,
        },
        employees
      )
      toast.success(`Payroll run created for ${activeCount} employee${activeCount !== 1 ? 's' : ''}`)
      onCreated(run)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create payroll run')
    } finally {
      setSaving(false)
    }
  }

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Run Payroll</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {activeCount === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950">
              <AlertCircle className="h-4 w-4 text-yellow-600 shrink-0" />
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                No active employees found. Add employees before running payroll.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This will generate pay stubs for <strong>{activeCount}</strong> active employee{activeCount !== 1 ? 's' : ''}.
            </p>
          )}

          <div className="space-y-2">
            <Label>Pay Period Start</Label>
            <Input type="date" value={form.pay_period_start} onChange={(e) => set('pay_period_start', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Pay Period End</Label>
            <Input type="date" value={form.pay_period_end} onChange={(e) => set('pay_period_end', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Pay Date</Label>
            <Input type="date" value={form.pay_date} onChange={(e) => set('pay_date', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional notes" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleRun} disabled={saving || activeCount === 0}>
            {saving ? 'Processing…' : 'Run Payroll'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Pay Stubs Dialog ─────────────────────────────────────────

interface PayStubsDialogProps {
  open: boolean
  run: PayrollRun | null
  onClose: () => void
}

function PayStubsDialog({ open, run, onClose }: PayStubsDialogProps) {
  if (!run) return null
  const stubs = (run.pay_stubs || []) as (PayStub & { employee?: Employee })[]

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Pay Stubs — {format(new Date(run.pay_period_start), 'MMM d')}–{format(new Date(run.pay_period_end), 'MMM d, yyyy')}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Gross Pay', value: fmt(run.total_gross), color: 'text-foreground' },
            { label: 'Deductions', value: fmt(run.total_deductions), color: 'text-red-600' },
            { label: 'Net Pay', value: fmt(run.total_net), color: 'text-green-600' },
            { label: 'Employer Taxes', value: fmt(run.total_employer_taxes), color: 'text-orange-600' },
          ].map((c) => (
            <div key={c.label} className="rounded-lg border p-3 text-center">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className={`font-semibold ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">Federal</TableHead>
              <TableHead className="text-right">State</TableHead>
              <TableHead className="text-right">SS</TableHead>
              <TableHead className="text-right">Medicare</TableHead>
              <TableHead className="text-right">Net Pay</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stubs.map((stub) => (
              <TableRow key={stub.id}>
                <TableCell>
                  <p className="font-medium">{stub.employee?.name || '—'}</p>
                  <p className="text-xs text-muted-foreground">{stub.employee?.title || ''}</p>
                </TableCell>
                <TableCell className="text-right">{fmt(stub.gross_pay)}</TableCell>
                <TableCell className="text-right text-red-600">-{fmt(stub.federal_tax)}</TableCell>
                <TableCell className="text-right text-red-600">-{fmt(stub.state_tax)}</TableCell>
                <TableCell className="text-right text-red-600">-{fmt(stub.social_security)}</TableCell>
                <TableCell className="text-right text-red-600">-{fmt(stub.medicare)}</TableCell>
                <TableCell className="text-right font-semibold text-green-600">{fmt(stub.net_pay)}</TableCell>
              </TableRow>
            ))}
            {stubs.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No pay stubs found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <p className="text-xs text-muted-foreground mt-2">
          * State tax is estimated at 5%. Federal tax uses 2025 IRS percentage method. Consult a payroll specialist for compliance.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Page ───────────────────────────────────────────────

export default function PayrollPage() {
  if (!showAdvancedModules) {
    return <DeferredModuleNotice moduleKey="payroll" />
  }

  return <PayrollWorkspace />
}

function PayrollWorkspace() {
  const { currentUser, organization, hasCapability } = useAppState()
  const canProcess = hasCapability(Capability.processPayroll)
  const canManageEmployees = hasCapability(Capability.manageEmployeeProfiles)

  const [employees, setEmployees] = useState<Employee[]>([])
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([])
  const [loading, setLoading] = useState(true)

  // Dialogs
  const [empDialog, setEmpDialog] = useState(false)
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null)
  const [deleteEmpId, setDeleteEmpId] = useState<string | null>(null)

  const [newRunDialog, setNewRunDialog] = useState(false)
  const [deleteRunId, setDeleteRunId] = useState<string | null>(null)
  const [viewRun, setViewRun] = useState<PayrollRun | null>(null)

  const orgId = organization?.id || currentUser?.id || ''
  const userId = currentUser?.id || ''

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [emps, runs] = await Promise.all([getEmployees(), getPayrollRuns()])
      setEmployees(emps)
      setPayrollRuns(runs)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load payroll data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Employee handlers
  const handleEmpSaved = (emp: Employee) => {
    setEmployees((prev) => {
      const idx = prev.findIndex((e) => e.id === emp.id)
      return idx >= 0 ? prev.map((e) => (e.id === emp.id ? emp : e)) : [...prev, emp]
    })
    setEmpDialog(false)
    setEditingEmp(null)
  }

  const handleDeleteEmp = async () => {
    if (!deleteEmpId) return
    try {
      await deleteEmployee(deleteEmpId)
      setEmployees((prev) => prev.filter((e) => e.id !== deleteEmpId))
      toast.success('Employee removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete employee')
    } finally {
      setDeleteEmpId(null)
    }
  }

  // Payroll run handlers
  const handleRunCreated = (run: PayrollRun) => {
    setPayrollRuns((prev) => [run, ...prev])
    setNewRunDialog(false)
    // Reload to get pay stubs in the run
    loadData()
  }

  const handleProcess = async (runId: string) => {
    try {
      const updated = await processPayrollRun(runId)
      setPayrollRuns((prev) => prev.map((r) => (r.id === runId ? updated : r)))
      toast.success('Payroll run completed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to process payroll run')
    }
  }

  const handleDeleteRun = async () => {
    if (!deleteRunId) return
    try {
      await deletePayrollRun(deleteRunId)
      setPayrollRuns((prev) => prev.filter((r) => r.id !== deleteRunId))
      toast.success('Payroll run deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete payroll run')
    } finally {
      setDeleteRunId(null)
    }
  }

  // YTD stats
  const currentYear = new Date().getFullYear()
  const ytdRuns = payrollRuns.filter(
    (r) => r.status === PayrollStatus.completed && new Date(r.pay_date).getFullYear() === currentYear
  )
  const ytdGross = ytdRuns.reduce((s, r) => s + r.total_gross, 0)
  const ytdDeductions = ytdRuns.reduce((s, r) => s + r.total_deductions, 0)
  const ytdEmployerTaxes = ytdRuns.reduce((s, r) => s + r.total_employer_taxes, 0)
  const activeEmployees = employees.filter((e) => e.is_active)

  if (loading) {
    return (
      <div className="p-6 text-center text-muted-foreground">Loading payroll…</div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Payroll</h1>
        <p className="text-muted-foreground text-sm">Manage employees, run payroll, and view reports</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" /> Active Employees
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{activeEmployees.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" /> YTD Gross Pay
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmt(ytdGross)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> YTD Net Pay
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmt(ytdGross - ytdDeductions)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" /> YTD Employer Taxes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmt(ytdEmployerTaxes)}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="employees">
        <TabsList>
          <TabsTrigger value="employees">Employees</TabsTrigger>
          <TabsTrigger value="runs">Payroll Runs</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        {/* ── Employees Tab ── */}
        <TabsContent value="employees" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              {activeEmployees.length} active · {employees.length - activeEmployees.length} inactive
            </p>
            {canManageEmployees && (
              <Button size="sm" onClick={() => { setEditingEmp(null); setEmpDialog(true) }}>
                <Plus className="h-4 w-4 mr-1" /> Add Employee
              </Button>
            )}
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Title / Dept</TableHead>
                  <TableHead>Salary</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Per Period</TableHead>
                  <TableHead>Status</TableHead>
                  {canManageEmployees && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((emp) => {
                  const calc = calculatePayStubAmounts(emp)
                  return (
                    <TableRow key={emp.id}>
                      <TableCell>
                        <p className="font-medium">{emp.name}</p>
                        <p className="text-xs text-muted-foreground">{emp.email}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm">{emp.title || '—'}</p>
                        <p className="text-xs text-muted-foreground">{emp.department || ''}</p>
                      </TableCell>
                      <TableCell>{fmt(emp.salary)}/yr</TableCell>
                      <TableCell>{payFrequencyLabels[emp.pay_frequency]}</TableCell>
                      <TableCell>
                        <p className="text-sm font-medium">{fmt(calc.gross_pay)}</p>
                        <p className="text-xs text-muted-foreground">net {fmt(calc.net_pay)}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={emp.is_active ? 'default' : 'secondary'}>
                          {emp.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      {canManageEmployees && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => { setEditingEmp(emp); setEmpDialog(true) }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              onClick={() => setDeleteEmpId(emp.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
                {employees.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canManageEmployees ? 7 : 6} className="text-center text-muted-foreground py-12">
                      No employees yet. Add your first employee to get started.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── Payroll Runs Tab ── */}
        <TabsContent value="runs" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              {payrollRuns.length} total run{payrollRuns.length !== 1 ? 's' : ''}
            </p>
            {canProcess && (
              <Button size="sm" onClick={() => setNewRunDialog(true)}>
                <PlayCircle className="h-4 w-4 mr-1" /> Run Payroll
              </Button>
            )}
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pay Period</TableHead>
                  <TableHead>Pay Date</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Net Pay</TableHead>
                  <TableHead className="text-right">Employer Taxes</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payrollRuns.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      {format(new Date(run.pay_period_start), 'MMM d')}–{format(new Date(run.pay_period_end), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell>{format(new Date(run.pay_date), 'MMM d, yyyy')}</TableCell>
                    <TableCell className="text-right">{fmt(run.total_gross)}</TableCell>
                    <TableCell className="text-right font-medium text-green-600">{fmt(run.total_net)}</TableCell>
                    <TableCell className="text-right text-orange-600">{fmt(run.total_employer_taxes)}</TableCell>
                    <TableCell>{statusBadge(run.status)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => setViewRun(run)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        {canProcess && run.status === PayrollStatus.draft && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-green-600"
                            onClick={() => handleProcess(run.id)}
                            title="Mark as Completed"
                          >
                            <PlayCircle className="h-4 w-4" />
                          </Button>
                        )}
                        {canProcess && run.status === PayrollStatus.draft && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive"
                            onClick={() => setDeleteRunId(run.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {payrollRuns.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                      No payroll runs yet. Click "Run Payroll" to get started.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── Reports Tab ── */}
        <TabsContent value="reports" className="mt-4 space-y-6">
          <div>
            <h3 className="font-semibold mb-3">{currentYear} Year-to-Date Summary</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Payroll Runs', value: ytdRuns.length.toString() },
                { label: 'Gross Payroll', value: fmt(ytdGross) },
                { label: 'Employee Taxes', value: fmt(ytdDeductions) },
                { label: 'Employer Taxes', value: fmt(ytdEmployerTaxes) },
              ].map((c) => (
                <Card key={c.label}>
                  <CardContent className="pt-4">
                    <p className="text-sm text-muted-foreground">{c.label}</p>
                    <p className="text-xl font-bold mt-1">{c.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <Separator />

          <div>
            <h3 className="font-semibold mb-3">Employee Pay Summary</h3>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Annual Salary</TableHead>
                    <TableHead>Pay Frequency</TableHead>
                    <TableHead className="text-right">Per-Period Gross</TableHead>
                    <TableHead className="text-right">Per-Period Net</TableHead>
                    <TableHead className="text-right">Annual Employer Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeEmployees.map((emp) => {
                    const calc = calculatePayStubAmounts(emp)
                    const periods = PAY_PERIODS_PER_YEAR[emp.pay_frequency]
                    const annualEmployerCost =
                      emp.salary + (calc.employer_ss + calc.employer_medicare) * periods
                    return (
                      <TableRow key={emp.id}>
                        <TableCell>
                          <p className="font-medium">{emp.name}</p>
                          <p className="text-xs text-muted-foreground">{emp.email}</p>
                        </TableCell>
                        <TableCell>{emp.department || '—'}</TableCell>
                        <TableCell>{fmt(emp.salary)}</TableCell>
                        <TableCell>{payFrequencyLabels[emp.pay_frequency]}</TableCell>
                        <TableCell className="text-right">{fmt(calc.gross_pay)}</TableCell>
                        <TableCell className="text-right text-green-600">{fmt(calc.net_pay)}</TableCell>
                        <TableCell className="text-right">{fmt(annualEmployerCost)}</TableCell>
                      </TableRow>
                    )
                  })}
                  {activeEmployees.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No active employees
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              * Employer cost includes salary + employer FICA (SS 6.2% + Medicare 1.45%). Excludes benefits, FUTA/SUTA.
              State tax estimated at 5% flat rate.
            </p>
          </div>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <EmployeeDialog
        open={empDialog}
        employee={editingEmp}
        orgId={orgId}
        userId={userId}
        onClose={() => { setEmpDialog(false); setEditingEmp(null) }}
        onSave={handleEmpSaved}
      />

      <NewRunDialog
        open={newRunDialog}
        employees={employees}
        orgId={orgId}
        userId={userId}
        onClose={() => setNewRunDialog(false)}
        onCreated={handleRunCreated}
      />

      <PayStubsDialog
        open={!!viewRun}
        run={viewRun}
        onClose={() => setViewRun(null)}
      />

      <AlertDialog open={!!deleteEmpId} onOpenChange={() => setDeleteEmpId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Employee?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the employee record. Past pay stubs are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteEmp} className="bg-destructive text-destructive-foreground">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteRunId} onOpenChange={() => setDeleteRunId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Payroll Run?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the payroll run and all associated pay stubs. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteRun} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
