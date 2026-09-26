'use client'

import { useState, useEffect, useRef } from 'react'
import { useDisplayDate } from '@/hooks/useDisplayDate'
import { useAuth } from '@/contexts/AuthContext'
import { useAppState } from '@/contexts/AppStateContext'

// Personal bills
import { getBills, createBill, updateBill, cancelBill, markBillPaid } from '@/services/bills.service'
import { useCreateAttempt } from '@/hooks/useCreateAttempt'
import { SaveAttemptNotice } from '@/components/SaveAttemptNotice'
import { RecordHistoryDialog } from '@/components/RecordHistoryDialog'
import type { Bill } from '@/types/models'
import {
  BillStatus,
  BillCategory,
  BillRecurrence,
  billStatusLabels,
  billCategoryLabels,
  billRecurrenceLabels,
} from '@/types/enums'

// AP (vendor bills + vendors + POs)
import {
  getVendors,
  createVendor,
  updateVendor,
  archiveVendor,
  getVendorBills,
  createVendorBill,
  cancelVendorBill,
  markVendorBillPaid,
  generateBillNumber,
  getPurchaseOrders,
  createPurchaseOrder,
  purchaseOrderAction,
  generatePONumber,
} from '@/services/accounts-payable.service'
import type { Vendor, VendorBill, PurchaseOrder } from '@/types/models'
import {
  AccountType,
  Capability,
  VendorStatus,
  vendorStatusLabels,
  PurchaseOrderStatus,
  purchaseOrderStatusLabels,
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
  CreditCard,
  Pencil,
  Trash2,
  Loader2,
  DollarSign,
  CheckCircle,
  CalendarClock,
  AlertCircle,
  RotateCcw,
  Building2,
  FileStack,
  ShoppingCart,
  Send,
  Wand2,
} from 'lucide-react'
import { toast } from 'sonner'
import { format, parseISO, differenceInDays, addDays } from 'date-fns'
import { captureInvoiceLineFromText } from '@/lib/invoice-ai'

// ─── Helpers ──────────────────────────────────────────────────

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return fallback
}

function getBillStatusVariant(status: BillStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case BillStatus.paid: return 'default'
    case BillStatus.due: return 'secondary'
    case BillStatus.overdue: return 'destructive'
    case BillStatus.cancelled: return 'outline'
    default: return 'secondary'
  }
}

function getPOStatusVariant(status: PurchaseOrderStatus): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case PurchaseOrderStatus.received: return 'default'
    case PurchaseOrderStatus.sent: return 'secondary'
    case PurchaseOrderStatus.cancelled: return 'outline'
    default: return 'secondary'
  }
}

interface LineItemRow { description: string; quantity: number; rate: number; amount: number }

type BillReminderItem = {
  id: string
  title: string
  detail: string
  amount: number
  badge: string
  tone: 'action' | 'watch' | 'ready'
}

// ─────────────────────────────────────────────────────────────
// PERSONAL BILLS VIEW
// ─────────────────────────────────────────────────────────────

function PersonalBillsView() {
  const displayDate = useDisplayDate()
  const { user } = useAuth()
  const [bills, setBills] = useState<Bill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [historyId,setHistoryId]=useState<string|null>(null)
  const [paymentBill,setPaymentBill]=useState<Bill|null>(null)
  const [paidOn,setPaidOn]=useState(format(new Date(),'yyyy-MM-dd'))
  const createAttempt = useCreateAttempt<Parameters<typeof createBill>[0]>()
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('upcoming')

  const [formData, setFormData] = useState({
    name: '', payee: '', amount: '',
    category: BillCategory.other,
    due_date: format(addDays(new Date(), 30), 'yyyy-MM-dd'),
    recurrence: BillRecurrence.monthly,
    auto_pay: false, notes: '',
  })

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      setError(null)
      setBills(await getBills())
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load data'
      setError(msg); toast.error(msg)
    } finally { setLoading(false) }
  }

  const openCreate = () => {
    if (!createAttempt.reset()) { setDialogOpen(true); return }
    setSelectedBill(null)
    setFormData({ name: '', payee: '', amount: '', category: BillCategory.other, due_date: format(addDays(new Date(), 30), 'yyyy-MM-dd'), recurrence: BillRecurrence.monthly, auto_pay: false, notes: '' })
    setDialogOpen(true)
  }

  const openEdit = (bill: Bill) => {
    if (!createAttempt.reset()) { setDialogOpen(true); return }
    setSelectedBill(bill)
    setFormData({ name: bill.name, payee: bill.payee, amount: bill.amount.toString(), category: bill.category, due_date: bill.due_date, recurrence: bill.recurrence, auto_pay: bill.auto_pay, notes: bill.notes || '' })
    setDialogOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); if (saving) return; setSaving(true)
    try {
      const data = { user_id: user?.id!, name: formData.name, payee: formData.payee, amount: parseFloat(formData.amount), currency: selectedBill?.currency ?? 'USD', category: formData.category, due_date: formData.due_date, status: BillStatus.upcoming, recurrence: formData.recurrence, auto_pay: formData.auto_pay, notes: formData.notes || undefined }
      if (selectedBill) { await updateBill(selectedBill.id, data, selectedBill.updated_at); toast.success('Bill updated') }
      else { await createAttempt.run(data, createBill); toast.success('Bill added') }
      setDialogOpen(false); loadData()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Failed to save bill') }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!selectedBill) return
    try { await cancelBill(selectedBill); toast.success('Bill cancelled; history preserved'); setDeleteDialogOpen(false); loadData() }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Failed to cancel bill') }
  }

  const handleMarkPaid = async (bill: Bill) => {
    setPaymentBill(bill); setPaidOn(format(new Date(),'yyyy-MM-dd'))
  }

  const getDaysLabel = (dueDate: string) => {
    const d = differenceInDays(parseISO(dueDate), new Date())
    if (d < 0) return `${Math.abs(d)}d overdue`
    if (d === 0) return 'Due today'
    return `${d}d left`
  }

  const unpaid = bills.filter(b => b.status !== BillStatus.paid && b.status !== BillStatus.cancelled)
  const paid = bills.filter(b => b.status === BillStatus.paid)
  const overdue = unpaid.filter(b => b.status === BillStatus.overdue || differenceInDays(parseISO(b.due_date), new Date()) < 0)
  const dueSoon = unpaid.filter((b) => {
    const days = differenceInDays(parseISO(b.due_date), new Date())
    return days >= 0 && days <= 7
  })
  const recurring = bills.filter(b => b.recurrence !== BillRecurrence.once)
  const billReminderItems: BillReminderItem[] = [
    ...overdue.slice(0, 2).map((bill) => ({
      id: `overdue-${bill.id}`,
      title: `${bill.name} is overdue`,
      detail: `${bill.payee} was due ${getDaysLabel(bill.due_date)}.`,
      amount: bill.amount,
      badge: 'Overdue',
      tone: 'action' as const,
    })),
    ...dueSoon.slice(0, 2).map((bill) => ({
      id: `soon-${bill.id}`,
      title: `${bill.name} is coming up`,
      detail: `${bill.payee} is ${getDaysLabel(bill.due_date)}.`,
      amount: bill.amount,
      badge: bill.auto_pay ? 'Auto-pay' : 'Due soon',
      tone: 'watch' as const,
    })),
  ]
  const visibleBillReminderItems = billReminderItems.length > 0
    ? billReminderItems.slice(0, 3)
    : [{
        id: 'clean',
        title: 'No bill reminders need attention',
        detail: 'Amountly will surface overdue and upcoming bills here as due dates get close.',
        amount: 0,
        badge: 'Ready',
        tone: 'ready' as const,
      }]

  const filtered = activeTab === 'upcoming' ? unpaid : activeTab === 'paid' ? paid : activeTab === 'recurring' ? recurring : bills

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
  if (error) return <div className="p-6"><Card><CardContent className="text-center py-12"><p className="text-destructive">{error}</p><Button onClick={loadData} className="mt-4">Try Again</Button></CardContent></Card></div>

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div><h1 className="text-2xl font-bold">Bills & Payments</h1><p className="text-muted-foreground">Track your bills and payment history</p></div>
        <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" />Add Bill</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total Due</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{formatCurrency(unpaid.reduce((s, b) => s + b.amount, 0))}</div><p className="text-xs text-muted-foreground">{unpaid.length} unpaid</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Paid This Month</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{formatCurrency(paid.reduce((s, b) => s + b.amount, 0))}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-destructive">Overdue</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-destructive">{overdue.length}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Recurring</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{recurring.length}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Wand2 className="w-4 h-4" />
                Smart Bill Reminders
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Amountly watches due dates and brings the next bill actions forward.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setActiveTab('upcoming')}
              className="shrink-0"
            >
              Review bills
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {visibleBillReminderItems.map((item) => (
              <div key={item.id} className="rounded-lg border bg-muted/30 p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <Badge variant={item.tone === 'action' ? 'destructive' : item.tone === 'ready' ? 'default' : 'secondary'}>
                    {item.badge}
                  </Badge>
                  {item.amount > 0 && <span className="text-sm font-semibold">{formatCurrency(item.amount)}</span>}
                </div>
                <p className="text-sm font-medium">{item.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="upcoming" className="gap-2"><CalendarClock className="w-4 h-4" />Upcoming ({unpaid.length})</TabsTrigger>
          <TabsTrigger value="paid" className="gap-2"><CheckCircle className="w-4 h-4" />Paid ({paid.length})</TabsTrigger>
          <TabsTrigger value="recurring" className="gap-2"><RotateCcw className="w-4 h-4" />Recurring ({recurring.length})</TabsTrigger>
          <TabsTrigger value="all">All ({bills.length})</TabsTrigger>
        </TabsList>
        <TabsContent value={activeTab} className="mt-4">
          {filtered.length === 0 ? (
            <Card><CardContent className="text-center py-12"><CreditCard className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" /><p className="text-muted-foreground">No bills found</p>{activeTab === 'upcoming' && <Button onClick={openCreate} className="mt-4 gap-2"><Plus className="w-4 h-4" />Add Bill</Button>}</CardContent></Card>
          ) : (
            <Card><CardContent className="pt-6">
              <Table>
                <TableHeader><TableRow><TableHead>Bill</TableHead><TableHead>Payee</TableHead><TableHead>Category</TableHead><TableHead>Due Date</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead>Recurrence</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filtered.map(bill => (
                    <TableRow key={bill.id}>
                      <TableCell className="font-medium">{bill.name}</TableCell>
                      <TableCell>{bill.payee}</TableCell>
                      <TableCell><Badge variant="outline">{billCategoryLabels[bill.category]}</Badge></TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{displayDate(bill.due_date)}</span>
                          {bill.status !== BillStatus.paid && bill.status !== BillStatus.cancelled && (
                            <span className={`text-xs ${differenceInDays(parseISO(bill.due_date), new Date()) < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{getDaysLabel(bill.due_date)}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(bill.amount)}</TableCell>
                      <TableCell><Badge variant={getBillStatusVariant(bill.status)}>{billStatusLabels[bill.status]}</Badge></TableCell>
                      <TableCell><span className="text-sm text-muted-foreground">{billRecurrenceLabels[bill.recurrence]}</span></TableCell>
                      <TableCell className="text-right">
                        {bill.status !== BillStatus.paid && bill.status !== BillStatus.cancelled && (
                          <Button variant="ghost" size="icon" title="Mark Paid" onClick={() => handleMarkPaid(bill)}><CheckCircle className="w-4 h-4 text-green-600" /></Button>
                        )}
                        <Button variant="ghost" size="icon" aria-label="Edit bill" disabled={['paid','cancelled'].includes(bill.status)} onClick={() => openEdit(bill)}><Pencil className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="sm" onClick={()=>setHistoryId(bill.id)}>History</Button>
                        <Button variant="ghost" size="icon" aria-label="Cancel bill" disabled={['paid','cancelled'].includes(bill.status)} onClick={() => { setSelectedBill(bill); setDeleteDialogOpen(true) }}><Trash2 className="w-4 h-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={open => { if (!saving) setDialogOpen(open) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{selectedBill ? 'Edit Bill' : 'Add Bill'}</DialogTitle><DialogDescription>{selectedBill ? 'Update bill details' : 'Add a new bill to track'}</DialogDescription></DialogHeader>
          <form onSubmit={handleSubmit}>
            <SaveAttemptNotice message={createAttempt.message} />
            <fieldset disabled={saving || createAttempt.unknown} className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Bill Name *</Label><Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Electric Bill" required /></div>
                <div className="space-y-2"><Label>Payee *</Label><Input value={formData.payee} onChange={e => setFormData({ ...formData, payee: e.target.value })} placeholder="e.g. Con Edison" required /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Amount *</Label><Input type="number" step="0.01" value={formData.amount} onChange={e => setFormData({ ...formData, amount: e.target.value })} required /></div>
                <div className="space-y-2"><Label>Category</Label>
                  <Select value={formData.category} onValueChange={v => setFormData({ ...formData, category: v as BillCategory })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(billCategoryLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Due Date *</Label><Input type="date" value={formData.due_date} onChange={e => setFormData({ ...formData, due_date: e.target.value })} required /></div>
                <div className="space-y-2"><Label>Recurrence</Label>
                  <Select value={formData.recurrence} onValueChange={v => setFormData({ ...formData, recurrence: v as BillRecurrence })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(billRecurrenceLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="auto_pay" checked={formData.auto_pay} onChange={e => setFormData({ ...formData, auto_pay: e.target.checked })} className="rounded" />
                <Label htmlFor="auto_pay" className="text-sm font-normal">Auto-pay enabled</Label>
              </div>
              <div className="space-y-2"><Label>Notes</Label><Textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} rows={2} /></div>
            </fieldset>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={saving} onClick={() => { setDialogOpen(false); if (createAttempt.unknown) void loadData() }}>{createAttempt.unknown ? 'Close and review list' : 'Cancel'}</Button>
              <Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{createAttempt.unknown ? 'Retry original save' : selectedBill ? 'Save Changes' : 'Add Bill'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Cancel Bill</AlertDialogTitle><AlertDialogDescription>Cancel &quot;{selectedBill?.name}&quot;? Its record and history will remain available.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep bill</AlertDialogCancel><AlertDialogAction onClick={handleDelete}>Confirm cancellation</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {historyId&&<RecordHistoryDialog kind="bills" id={historyId} onClose={()=>setHistoryId(null)} />}
      <Dialog open={!!paymentBill} onOpenChange={open=>{if(!open&&!saving)setPaymentBill(null)}}><DialogContent><DialogHeader><DialogTitle>Record bill payment</DialogTitle><DialogDescription>Record when you paid this bill. This does not send money or enable AutoPay.</DialogDescription></DialogHeader><p>{paymentBill?.name} · {paymentBill?.amount} {paymentBill?.currency}</p><Label htmlFor="bill-paid-on">Date paid</Label><Input id="bill-paid-on" type="date" max={format(new Date(),'yyyy-MM-dd')} value={paidOn} onChange={event=>setPaidOn(event.target.value)} /><Button disabled={saving||!paidOn} onClick={async()=>{if(!paymentBill)return;setSaving(true);try{await markBillPaid(paymentBill,paidOn);setPaymentBill(null);toast.success('Payment recorded');await loadData()}catch(error){toast.error(error instanceof Error?error.message:'Could not record payment')}finally{setSaving(false)}}}>Confirm payment record</Button></DialogContent></Dialog>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// ACCOUNTS PAYABLE VIEW (Freelancer / Business)
// ─────────────────────────────────────────────────────────────

function AccountsPayableView() {
  const displayDate = useDisplayDate()
  const [payableTab, setPayableTab] = useState('bills')
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'vendors') setPayableTab('vendors')
  }, [])
  const { user } = useAuth()
  const { hasCapability } = useAppState()
  const canManageVendors = hasCapability(Capability.manageVendors)
  const canManageBills = hasCapability(Capability.manageBills)
  const canCreatePOs = hasCapability(Capability.createPurchaseOrders)

  const [vendors, setVendors] = useState<Vendor[]>([])
  const [bills, setBills] = useState<VendorBill[]>([])
  const [pos, setPOs] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Vendor dialog
  const [vendorDialog, setVendorDialog] = useState(false)
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null)
  const [vendorForm, setVendorForm] = useState({ name: '', email: '', phone: '', contact_name: '', address: '', city: '', state: '', country: 'US', tax_id: '', payment_terms: '30', notes: '' })
  const [savingVendor, setSavingVendor] = useState(false)

  // Bill dialog
  const [billDialog, setBillDialog] = useState(false)
  const [savingBill, setSavingBill] = useState(false)
  const vendorBillAttempt = useCreateAttempt<{ input: Parameters<typeof createVendorBill>[0]; lines: Parameters<typeof createVendorBill>[1] }>()
  const [paymentBill,setPaymentBill]=useState<VendorBill|null>(null)
  const [paidOn,setPaidOn]=useState(format(new Date(),'yyyy-MM-dd'))
  const [historyId,setHistoryId]=useState<string|null>(null)
  const [billForm, setBillForm] = useState({ vendor_id: '', bill_number: '', issue_date: format(new Date(), 'yyyy-MM-dd'), due_date: format(addDays(new Date(), 30), 'yyyy-MM-dd'), tax_rate: '0', notes: '' })
  const [billLines, setBillLines] = useState<LineItemRow[]>([{ description: '', quantity: 1, rate: 0, amount: 0 }])
  const [billLineCaptureText, setBillLineCaptureText] = useState('')
  const [billLineCaptureSummary, setBillLineCaptureSummary] = useState<string | null>(null)
  const billLineCaptureTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  // PO dialog
  const [poDialog, setPODialog] = useState(false)
  const [savingPO, setSavingPO] = useState(false)
  const poAttempt = useCreateAttempt<{ input: Parameters<typeof createPurchaseOrder>[0]; lines: Parameters<typeof createPurchaseOrder>[1] }>()
  const [poConfirmation, setPOConfirmation] = useState<{ po: PurchaseOrder; action: 'send' | 'receive' } | null>(null)
  const [poHistory, setPOHistory] = useState<string | null>(null)
  const [poForm, setPOForm] = useState({ vendor_id: '', po_number: '', date: format(new Date(), 'yyyy-MM-dd'), expected_date: '', tax_rate: '0', notes: '' })
  const [poLines, setPOLines] = useState<LineItemRow[]>([{ description: '', quantity: 1, rate: 0, amount: 0 }])

  // Delete
  const [deleteDialog, setDeleteDialog] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'vendor' | 'bill' | 'po'; id: string; label: string } | null>(null)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      setError(null)
      const [v, b, p] = await Promise.all([getVendors(), getVendorBills(), getPurchaseOrders()])
      setVendors(v); setBills(b); setPOs(p)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load data'
      setError(msg); toast.error(msg)
    } finally { setLoading(false) }
  }

  // ── Vendor handlers ──

  const openCreateVendor = () => {
    setSelectedVendor(null)
    setVendorForm({ name: '', email: '', phone: '', contact_name: '', address: '', city: '', state: '', country: 'US', tax_id: '', payment_terms: '30', notes: '' })
    setVendorDialog(true)
  }

  const openEditVendor = (v: Vendor) => {
    setSelectedVendor(v)
    setVendorForm({ name: v.name, email: v.email || '', phone: v.phone || '', contact_name: v.contact_name || '', address: v.address || '', city: v.city || '', state: v.state || '', country: v.country || 'US', tax_id: v.tax_id || '', payment_terms: v.payment_terms?.toString() || '30', notes: v.notes || '' })
    setVendorDialog(true)
  }

  const handleSaveVendor = async (e: React.FormEvent) => {
    e.preventDefault(); setSavingVendor(true)
    try {
      const input = { user_id: user?.id, organization_id: user?.organization_id, name: vendorForm.name, email: vendorForm.email || undefined, phone: vendorForm.phone || undefined, contact_name: vendorForm.contact_name || undefined, address: vendorForm.address || undefined, city: vendorForm.city || undefined, state: vendorForm.state || undefined, country: vendorForm.country || undefined, tax_id: vendorForm.tax_id || undefined, payment_terms: parseInt(vendorForm.payment_terms) || 30, notes: vendorForm.notes || undefined, status: VendorStatus.active }
      if (selectedVendor) { await updateVendor(selectedVendor.id, input); toast.success('Vendor updated') }
      else { await createVendor(input); toast.success('Vendor created') }
      setVendorDialog(false); loadData()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to save vendor'))
    }
    finally { setSavingVendor(false) }
  }

  // ── Bill line item helpers ──

  const updateBillLine = (i: number, field: keyof LineItemRow, val: string | number) => {
    const lines = [...billLines]
    lines[i] = { ...lines[i], [field]: val }
    if (field === 'quantity' || field === 'rate') lines[i].amount = lines[i].quantity * lines[i].rate
    setBillLines(lines)
  }

  const billSubtotal = billLines.reduce((s, l) => s + l.amount, 0)
  const billTaxAmt = billSubtotal * (parseFloat(billForm.tax_rate) / 100 || 0)
  const billTotal = billSubtotal + billTaxAmt

  // ── Bill handlers ──

  const openCreateBill = async () => {
    if (!vendorBillAttempt.reset()) { setBillDialog(true); return }
    const num = await generateBillNumber()
    setBillForm({ vendor_id: '', bill_number: num, issue_date: format(new Date(), 'yyyy-MM-dd'), due_date: format(addDays(new Date(), 30), 'yyyy-MM-dd'), tax_rate: '0', notes: '' })
    setBillLines([{ description: '', quantity: 1, rate: 0, amount: 0 }])
    setBillLineCaptureText('')
    setBillLineCaptureSummary(null)
    setBillDialog(true)
  }

  const handleBillLineCapture = async (text = billLineCaptureTextareaRef.current?.value ?? billLineCaptureText) => {
    try {
      setBillLineCaptureSummary('Asking Amountly AI...')
      const captured = await captureInvoiceLineFromText(text)
      const nextLine = {
        description: captured.description,
        quantity: captured.quantity,
        rate: captured.rate,
        amount: captured.amount,
      }
      const hasOnlyEmptyLine =
        billLines.length === 1 &&
        !billLines[0].description &&
        billLines[0].quantity === 1 &&
        billLines[0].rate === 0

      setBillLines(hasOnlyEmptyLine ? [nextLine] : [...billLines, nextLine])
      setBillLineCaptureSummary(captured.reason)
    } catch (error) {
      const message = getErrorMessage(error, 'AI line capture failed')
      setBillLineCaptureSummary(message)
      toast.error(message)
    }
  }

  const handleSaveBill = async (e: React.FormEvent) => {
    e.preventDefault(); if (savingBill) return; setSavingBill(true)
    try {
      const input = { user_id: user!.id, organization_id: user?.organization_id, vendor_id: billForm.vendor_id, bill_number: billForm.bill_number, issue_date: billForm.issue_date, due_date: billForm.due_date, subtotal: billSubtotal, tax_rate: parseFloat(billForm.tax_rate) || 0, tax_amount: billTaxAmt, total: billTotal, currency: 'USD', status: BillStatus.upcoming, notes: billForm.notes || undefined }
      const lines = billLines.filter(l => l.description).map((l, i) => ({ ...l, order: i }))
      await vendorBillAttempt.run({ input, lines }, (original, id) => createVendorBill(original.input, original.lines, id))
      toast.success('Bill created'); setBillDialog(false); loadData()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to save bill'))
    }
    finally { setSavingBill(false) }
  }

  // ── PO line item helpers ──

  const updatePOLine = (i: number, field: keyof LineItemRow, val: string | number) => {
    const lines = [...poLines]
    lines[i] = { ...lines[i], [field]: val }
    if (field === 'quantity' || field === 'rate') lines[i].amount = lines[i].quantity * lines[i].rate
    setPOLines(lines)
  }

  const poSubtotal = poLines.reduce((s, l) => s + l.amount, 0)
  const poTaxAmt = poSubtotal * (parseFloat(poForm.tax_rate) / 100 || 0)
  const poTotal = poSubtotal + poTaxAmt

  // ── PO handlers ──

  const openCreatePO = async () => {
    if (!poAttempt.reset()) { setPODialog(true); return }
    const num = await generatePONumber()
    setPOForm({ vendor_id: '', po_number: num, date: format(new Date(), 'yyyy-MM-dd'), expected_date: '', tax_rate: '0', notes: '' })
    setPOLines([{ description: '', quantity: 1, rate: 0, amount: 0 }])
    setPODialog(true)
  }

  const handleSavePO = async (e: React.FormEvent) => {
    e.preventDefault(); if (savingPO) return; setSavingPO(true)
    try {
      const input = { user_id: user?.id, organization_id: user?.organization_id, vendor_id: poForm.vendor_id, po_number: poForm.po_number, date: poForm.date, expected_date: poForm.expected_date || undefined, subtotal: poSubtotal, tax_rate: parseFloat(poForm.tax_rate) || 0, tax_amount: poTaxAmt, total: poTotal, currency: 'USD', status: PurchaseOrderStatus.draft, notes: poForm.notes || undefined }
      const lines = poLines.filter(l => l.description).map((l, i) => ({ ...l, order: i }))
      await poAttempt.run({ input, lines }, (original, id) => createPurchaseOrder(original.input, original.lines, id))
      toast.success('PO created'); setPODialog(false); loadData()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to save PO'))
    }
    finally { setSavingPO(false) }
  }

  // ── Delete ──

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      if (deleteTarget.type === 'vendor') await archiveVendor(deleteTarget.id)
      else if (deleteTarget.type === 'bill') await cancelVendorBill(bills.find(bill=>bill.id===deleteTarget.id)!)
      else await purchaseOrderAction(pos.find(po => po.id === deleteTarget.id)!, 'cancel')
      toast.success(deleteTarget.type==='bill'?'Bill cancelled':deleteTarget.type==='vendor'?'Vendor archived':'Purchase order cancelled; history preserved'); setDeleteDialog(false); loadData()
    } catch (error) { toast.error(getErrorMessage(error, 'Could not confirm the change')) }
  }

  // ── Computed ──

  const unpaidBills = bills.filter(b => b.status !== BillStatus.paid && b.status !== BillStatus.cancelled)
  const overdueBills = bills.filter(b => {
    if (b.status === BillStatus.paid || b.status === BillStatus.cancelled) return false
    return differenceInDays(parseISO(b.due_date), new Date()) < 0
  })
  const dueSoonBills = unpaidBills.filter((bill) => {
    const days = differenceInDays(parseISO(bill.due_date), new Date())
    return days >= 0 && days <= 7
  })
  const totalOutstanding = unpaidBills.reduce((s, b) => s + b.total, 0)
  const vendorBillReminderItems: BillReminderItem[] = [
    ...overdueBills.slice(0, 2).map((bill) => ({
      id: `overdue-${bill.id}`,
      title: `${bill.bill_number} is overdue`,
      detail: `${bill.vendor?.name || 'Vendor bill'} was due ${displayDate(bill.due_date)}.`,
      amount: bill.total,
      badge: 'Overdue',
      tone: 'action' as const,
    })),
    ...dueSoonBills.slice(0, 2).map((bill) => ({
      id: `soon-${bill.id}`,
      title: `${bill.bill_number} is due soon`,
      detail: `${bill.vendor?.name || 'Vendor bill'} is due in ${differenceInDays(parseISO(bill.due_date), new Date())} day${differenceInDays(parseISO(bill.due_date), new Date()) === 1 ? '' : 's'}.`,
      amount: bill.total,
      badge: 'Due soon',
      tone: 'watch' as const,
    })),
  ]
  const visibleVendorBillReminderItems = vendorBillReminderItems.length > 0
    ? vendorBillReminderItems.slice(0, 3)
    : [{
        id: 'clean',
        title: 'No vendor bill reminders need attention',
        detail: 'Overdue and near-term vendor bills will appear here automatically.',
        amount: 0,
        badge: 'Ready',
        tone: 'ready' as const,
      }]

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
  if (error) return <div className="p-6"><Card><CardContent className="text-center py-12"><p className="text-destructive">{error}</p><Button onClick={loadData} className="mt-4">Try Again</Button></CardContent></Card></div>

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Bills & Vendors</h1>
        <p className="text-muted-foreground">Accounts payable — vendor management, bills, and purchase orders</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Vendors</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{vendors.length}</div><p className="text-xs text-muted-foreground">{vendors.filter(v => v.status === VendorStatus.active).length} active</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Outstanding</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{formatCurrency(totalOutstanding)}</div><p className="text-xs text-muted-foreground">{unpaidBills.length} unpaid bills</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-destructive">Overdue</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-destructive">{overdueBills.length}</div><p className="text-xs text-muted-foreground">past due date</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Open POs</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{pos.filter(p => p.status !== PurchaseOrderStatus.received && p.status !== PurchaseOrderStatus.cancelled).length}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Wand2 className="w-4 h-4" />
                Smart Bill Reminders
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Amountly highlights overdue and upcoming vendor bills before they surprise cash flow.
              </p>
            </div>
            {canManageBills && <Button type="button" variant="outline" size="sm" onClick={openCreateBill} className="shrink-0">New Bill</Button>}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {visibleVendorBillReminderItems.map((item) => (
              <div key={item.id} className="rounded-lg border bg-muted/30 p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <Badge variant={item.tone === 'action' ? 'destructive' : item.tone === 'ready' ? 'default' : 'secondary'}>
                    {item.badge}
                  </Badge>
                  {item.amount > 0 && <span className="text-sm font-semibold">{formatCurrency(item.amount)}</span>}
                </div>
                <p className="text-sm font-medium">{item.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={payableTab} onValueChange={setPayableTab}>
        <TabsList>
          <TabsTrigger value="bills" className="gap-2"><FileStack className="w-4 h-4" />Bills ({bills.length})</TabsTrigger>
          <TabsTrigger value="vendors" className="gap-2"><Building2 className="w-4 h-4" />Vendors ({vendors.length})</TabsTrigger>
          {canCreatePOs && <TabsTrigger value="pos" className="gap-2"><ShoppingCart className="w-4 h-4" />Purchase Orders ({pos.length})</TabsTrigger>}
        </TabsList>

        {/* ── Bills Tab ── */}
        <TabsContent value="bills" className="mt-4 space-y-4">
          <div className="flex justify-end">
            {canManageBills && <Button onClick={openCreateBill} className="gap-2"><Plus className="w-4 h-4" />New Bill</Button>}
          </div>
          {bills.length === 0 ? (
            <Card><CardContent className="text-center py-12"><FileStack className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" /><p className="text-muted-foreground">No vendor bills yet</p>{canManageBills && <Button onClick={openCreateBill} className="mt-4 gap-2"><Plus className="w-4 h-4" />New Bill</Button>}</CardContent></Card>
          ) : (
            <Card><CardContent className="pt-6">
              <Table>
                <TableHeader><TableRow><TableHead>Bill #</TableHead><TableHead>Vendor</TableHead><TableHead>Issue Date</TableHead><TableHead>Due Date</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {bills.map(bill => {
                    const daysLeft = differenceInDays(parseISO(bill.due_date), new Date())
                    const isPastDue = daysLeft < 0 && bill.status !== BillStatus.paid
                    return (
                      <TableRow key={bill.id}>
                        <TableCell className="font-mono font-medium">{bill.bill_number}</TableCell>
                        <TableCell>{bill.vendor?.name || '—'}</TableCell>
                        <TableCell>{displayDate(bill.issue_date)}</TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span>{displayDate(bill.due_date)}</span>
                            {isPastDue && <span className="text-xs text-destructive">{Math.abs(daysLeft)}d overdue</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(bill.total)}</TableCell>
                        <TableCell><Badge variant={getBillStatusVariant(bill.status)}>{billStatusLabels[bill.status]}</Badge></TableCell>
                        <TableCell className="text-right">
                          {bill.status !== BillStatus.paid && bill.status !== BillStatus.cancelled && canManageBills && (
                            <Button variant="ghost" size="icon" title="Mark Paid" onClick={() => {setPaymentBill(bill);setPaidOn(format(new Date(),'yyyy-MM-dd'))}}><CheckCircle className="w-4 h-4 text-green-600" /></Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={()=>setHistoryId(bill.id)}>History</Button>
                          {canManageBills && !['paid','cancelled'].includes(bill.status) && <Button title="Cancel bill" variant="ghost" size="icon" onClick={() => { setDeleteTarget({ type: 'bill', id: bill.id, label: bill.bill_number }); setDeleteDialog(true) }}><Trash2 className="w-4 h-4" /></Button>}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent></Card>
          )}
        </TabsContent>

        {/* ── Vendors Tab ── */}
        <TabsContent value="vendors" className="mt-4 space-y-4">
          <div className="flex justify-end">
            {canManageVendors && <Button onClick={openCreateVendor} className="gap-2"><Plus className="w-4 h-4" />New Vendor</Button>}
          </div>
          {vendors.length === 0 ? (
            <Card><CardContent className="text-center py-12"><Building2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" /><p className="text-muted-foreground">No vendors yet</p>{canManageVendors && <Button onClick={openCreateVendor} className="mt-4 gap-2"><Plus className="w-4 h-4" />New Vendor</Button>}</CardContent></Card>
          ) : (
            <Card><CardContent className="pt-6">
              <Table>
                <TableHeader><TableRow><TableHead>Vendor</TableHead><TableHead>Contact</TableHead><TableHead>Email</TableHead><TableHead>Phone</TableHead><TableHead>Payment Terms</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {vendors.map(v => (
                    <TableRow key={v.id}>
                      <TableCell className="font-medium">{v.name}</TableCell>
                      <TableCell>{v.contact_name || '—'}</TableCell>
                      <TableCell>{v.email || '—'}</TableCell>
                      <TableCell>{v.phone || '—'}</TableCell>
                      <TableCell>{v.payment_terms ? `Net ${v.payment_terms}` : '—'}</TableCell>
                      <TableCell><Badge variant={v.status === VendorStatus.active ? 'default' : 'outline'}>{vendorStatusLabels[v.status]}</Badge></TableCell>
                      <TableCell className="text-right">
                        {canManageVendors && <>
                          <Button variant="ghost" size="icon" onClick={() => openEditVendor(v)}><Pencil className="w-4 h-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => { setDeleteTarget({ type: 'vendor', id: v.id, label: v.name }); setDeleteDialog(true) }}><Trash2 className="w-4 h-4" /></Button>
                        </>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          )}
        </TabsContent>

        {/* ── Purchase Orders Tab ── */}
        {canCreatePOs && (
          <TabsContent value="pos" className="mt-4 space-y-4">
            <div className="flex justify-end">
              <Button onClick={openCreatePO} className="gap-2"><Plus className="w-4 h-4" />New PO</Button>
            </div>
            {pos.length === 0 ? (
              <Card><CardContent className="text-center py-12"><ShoppingCart className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" /><p className="text-muted-foreground">No purchase orders yet</p><Button onClick={openCreatePO} className="mt-4 gap-2"><Plus className="w-4 h-4" />New PO</Button></CardContent></Card>
            ) : (
              <Card><CardContent className="pt-6">
                <Table>
                  <TableHeader><TableRow><TableHead>PO #</TableHead><TableHead>Vendor</TableHead><TableHead>Date</TableHead><TableHead>Expected</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {pos.map(po => (
                      <TableRow key={po.id}>
                        <TableCell className="font-mono font-medium">{po.po_number}</TableCell>
                        <TableCell>{po.vendor?.name || '—'}</TableCell>
                        <TableCell>{displayDate(po.date)}</TableCell>
                        <TableCell>{po.expected_date ? displayDate(po.expected_date) : '—'}</TableCell>
                        <TableCell className="text-right font-medium">{po.currency ? new Intl.NumberFormat('en-US', { style: 'currency', currency: po.currency }).format(po.total) : `${po.total} · Currency unknown`}</TableCell>
                        <TableCell><Badge variant={getPOStatusVariant(po.status)}>{purchaseOrderStatusLabels[po.status]}</Badge></TableCell>
                        <TableCell className="text-right">
                          {po.status === PurchaseOrderStatus.draft && <Button variant="ghost" size="icon" title="Mark Sent" disabled={!po.currency} onClick={() => setPOConfirmation({ po, action: 'send' })}><Send className="w-4 h-4" /></Button>}
                          {po.status === PurchaseOrderStatus.sent && <Button variant="ghost" size="icon" title="Mark Received" disabled={!po.currency} onClick={() => setPOConfirmation({ po, action: 'receive' })}><CheckCircle className="w-4 h-4 text-green-600" /></Button>}
                          <Button variant="ghost" size="sm" onClick={() => setPOHistory(po.id)}>History</Button>
                          <Button variant="ghost" size="icon" title="Cancel purchase order" disabled={!['draft','sent'].includes(po.status)} onClick={() => { setDeleteTarget({ type: 'po', id: po.id, label: po.po_number }); setDeleteDialog(true) }}><Trash2 className="w-4 h-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            )}
          </TabsContent>
        )}
      </Tabs>

      {/* ── Vendor Dialog ── */}
      <Dialog open={vendorDialog} onOpenChange={setVendorDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{selectedVendor ? 'Edit Vendor' : 'New Vendor'}</DialogTitle><DialogDescription>Manage vendor contact and payment information</DialogDescription></DialogHeader>
          <form onSubmit={handleSaveVendor}>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2 col-span-2"><Label>Vendor Name *</Label><Input value={vendorForm.name} onChange={e => setVendorForm({ ...vendorForm, name: e.target.value })} required /></div>
                <div className="space-y-2"><Label>Email</Label><Input type="email" value={vendorForm.email} onChange={e => setVendorForm({ ...vendorForm, email: e.target.value })} /></div>
                <div className="space-y-2"><Label>Phone</Label><Input value={vendorForm.phone} onChange={e => setVendorForm({ ...vendorForm, phone: e.target.value })} /></div>
                <div className="space-y-2"><Label>Contact Name</Label><Input value={vendorForm.contact_name} onChange={e => setVendorForm({ ...vendorForm, contact_name: e.target.value })} /></div>
                <div className="space-y-2"><Label>Tax ID / EIN</Label><Input value={vendorForm.tax_id} onChange={e => setVendorForm({ ...vendorForm, tax_id: e.target.value })} /></div>
                <div className="space-y-2"><Label>City</Label><Input value={vendorForm.city} onChange={e => setVendorForm({ ...vendorForm, city: e.target.value })} /></div>
                <div className="space-y-2"><Label>State</Label><Input value={vendorForm.state} onChange={e => setVendorForm({ ...vendorForm, state: e.target.value })} /></div>
                <div className="space-y-2"><Label>Payment Terms (days)</Label><Input type="number" value={vendorForm.payment_terms} onChange={e => setVendorForm({ ...vendorForm, payment_terms: e.target.value })} /></div>
                <div className="space-y-2"><Label>Country</Label><Input value={vendorForm.country} onChange={e => setVendorForm({ ...vendorForm, country: e.target.value })} /></div>
                <div className="space-y-2 col-span-2"><Label>Notes</Label><Textarea value={vendorForm.notes} onChange={e => setVendorForm({ ...vendorForm, notes: e.target.value })} rows={2} /></div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setVendorDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={savingVendor}>{savingVendor && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{selectedVendor ? 'Save Changes' : 'Create Vendor'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Bill Dialog ── */}
      <Dialog open={billDialog} onOpenChange={open => { if (!savingBill) setBillDialog(open) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Vendor Bill</DialogTitle><DialogDescription>Record a bill received from a vendor</DialogDescription></DialogHeader>
          <form onSubmit={handleSaveBill}>
            <SaveAttemptNotice message={vendorBillAttempt.message} />
            <fieldset disabled={savingBill || vendorBillAttempt.unknown} className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Bill Number</Label><Input value={billForm.bill_number} readOnly className="bg-muted" /></div>
                <div className="space-y-2"><Label>Vendor *</Label>
                  <Select value={billForm.vendor_id} onValueChange={v => setBillForm({ ...billForm, vendor_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                    <SelectContent>{vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Issue Date</Label><Input type="date" value={billForm.issue_date} onChange={e => setBillForm({ ...billForm, issue_date: e.target.value })} /></div>
                <div className="space-y-2"><Label>Due Date *</Label><Input type="date" value={billForm.due_date} onChange={e => setBillForm({ ...billForm, due_date: e.target.value })} required /></div>
                <div className="space-y-2"><Label>Tax Rate (%)</Label><Input type="number" step="0.01" value={billForm.tax_rate} onChange={e => setBillForm({ ...billForm, tax_rate: e.target.value })} /></div>
              </div>
              {/* Line items */}
              <div className="space-y-2">
                <Label>Items</Label>
                <div className="border rounded-lg p-3 space-y-2">
                  <div className="mb-4 rounded-lg border bg-primary/5 p-3">
                    <div className="mb-3 flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Wand2 className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Smart bill line</p>
                        <p className="text-sm text-muted-foreground">
                          Describe the vendor charge and Amountly will add an item.
                        </p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <Textarea
                        ref={billLineCaptureTextareaRef}
                        value={billLineCaptureText}
                        onChange={(e) => {
                          setBillLineCaptureText(e.target.value)
                          setBillLineCaptureSummary(null)
                        }}
                        placeholder="Example: Cloud hosting 1 at 89.99"
                        rows={2}
                      />
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-muted-foreground">
                          {billLineCaptureSummary || 'Amountly looks for description, quantity, and rate.'}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleBillLineCapture()}
                          disabled={!billLineCaptureText.trim()}
                          className="shrink-0 gap-2"
                        >
                          <Wand2 className="h-4 w-4" />
                          Add smart item
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground"><div className="col-span-5">Description</div><div className="col-span-2">Qty</div><div className="col-span-2">Rate</div><div className="col-span-2 text-right">Amount</div><div className="col-span-1" /></div>
                  {billLines.map((line, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-5"><Input className="h-8 text-xs" value={line.description} onChange={e => updateBillLine(i, 'description', e.target.value)} placeholder="Description" /></div>
                      <div className="col-span-2"><Input className="h-8 text-xs" type="number" value={line.quantity} onChange={e => updateBillLine(i, 'quantity', parseFloat(e.target.value) || 0)} /></div>
                      <div className="col-span-2"><Input className="h-8 text-xs" type="number" step="0.01" value={line.rate} onChange={e => updateBillLine(i, 'rate', parseFloat(e.target.value) || 0)} /></div>
                      <div className="col-span-2 text-right text-sm font-medium">{formatCurrency(line.amount)}</div>
                      <div className="col-span-1"><Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setBillLines(billLines.filter((_, j) => j !== i))} disabled={billLines.length <= 1}><Trash2 className="w-3 h-3" /></Button></div>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={() => setBillLines([...billLines, { description: '', quantity: 1, rate: 0, amount: 0 }])}><Plus className="w-3 h-3 mr-1" />Add Line</Button>
                  <div className="border-t pt-2 space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(billSubtotal)}</span></div>
                    {parseFloat(billForm.tax_rate) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax ({billForm.tax_rate}%)</span><span>{formatCurrency(billTaxAmt)}</span></div>}
                    <div className="flex justify-between font-semibold"><span>Total</span><span>{formatCurrency(billTotal)}</span></div>
                  </div>
                </div>
              </div>
              <div className="space-y-2"><Label>Notes</Label><Textarea value={billForm.notes} onChange={e => setBillForm({ ...billForm, notes: e.target.value })} rows={2} /></div>
            </fieldset>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={savingBill} onClick={() => { setBillDialog(false); if (vendorBillAttempt.unknown) void loadData() }}>{vendorBillAttempt.unknown ? 'Close and review list' : 'Cancel'}</Button>
              <Button type="submit" disabled={savingBill || !billForm.vendor_id}>{savingBill && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{vendorBillAttempt.unknown ? 'Retry original save' : 'Create Bill'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {poHistory && <RecordHistoryDialog kind="purchase_orders" id={poHistory} onClose={() => setPOHistory(null)} />}
      <Dialog open={!!poConfirmation} onOpenChange={open => { if (!open && !savingPO) setPOConfirmation(null) }}><DialogContent><DialogHeader><DialogTitle>{poConfirmation?.action === 'send' ? 'Record purchase order as sent?' : 'Confirm items received?'}</DialogTitle><DialogDescription>This records a status change and preserves history. It does not send the order, transfer money, or create a vendor bill.</DialogDescription></DialogHeader><p>{poConfirmation?.po.po_number}</p><Button disabled={savingPO} onClick={async () => { if (!poConfirmation) return; setSavingPO(true); try { await purchaseOrderAction(poConfirmation.po, poConfirmation.action); setPOConfirmation(null); await loadData(); toast.success('Purchase order status recorded') } catch(error) { toast.error(getErrorMessage(error, 'Could not update order')) } finally { setSavingPO(false) } }}>Confirm status</Button></DialogContent></Dialog>

      {/* ── PO Dialog ── */}
      <Dialog open={poDialog} onOpenChange={open => { if (!savingPO) setPODialog(open) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Purchase Order</DialogTitle><DialogDescription>Create a purchase order for a vendor</DialogDescription></DialogHeader>
          <form onSubmit={handleSavePO}>
            <SaveAttemptNotice message={poAttempt.message} />
            <fieldset disabled={savingPO || poAttempt.unknown} className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>PO Number</Label><Input value={poForm.po_number} readOnly className="bg-muted" /></div>
                <div className="space-y-2"><Label>Vendor *</Label>
                  <Select value={poForm.vendor_id} onValueChange={v => setPOForm({ ...poForm, vendor_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                    <SelectContent>{vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Order Date</Label><Input type="date" value={poForm.date} onChange={e => setPOForm({ ...poForm, date: e.target.value })} /></div>
                <div className="space-y-2"><Label>Expected Delivery</Label><Input type="date" value={poForm.expected_date} onChange={e => setPOForm({ ...poForm, expected_date: e.target.value })} /></div>
              </div>
              {/* PO Line items */}
              <div className="space-y-2">
                <Label>Items</Label>
                <div className="border rounded-lg p-3 space-y-2">
                  <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground"><div className="col-span-5">Description</div><div className="col-span-2">Qty</div><div className="col-span-2">Rate</div><div className="col-span-2 text-right">Amount</div><div className="col-span-1" /></div>
                  {poLines.map((line, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-5"><Input className="h-8 text-xs" value={line.description} onChange={e => updatePOLine(i, 'description', e.target.value)} placeholder="Item or service" /></div>
                      <div className="col-span-2"><Input className="h-8 text-xs" type="number" value={line.quantity} onChange={e => updatePOLine(i, 'quantity', parseFloat(e.target.value) || 0)} /></div>
                      <div className="col-span-2"><Input className="h-8 text-xs" type="number" step="0.01" value={line.rate} onChange={e => updatePOLine(i, 'rate', parseFloat(e.target.value) || 0)} /></div>
                      <div className="col-span-2 text-right text-sm font-medium">{formatCurrency(line.amount)}</div>
                      <div className="col-span-1"><Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPOLines(poLines.filter((_, j) => j !== i))} disabled={poLines.length <= 1}><Trash2 className="w-3 h-3" /></Button></div>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={() => setPOLines([...poLines, { description: '', quantity: 1, rate: 0, amount: 0 }])}><Plus className="w-3 h-3 mr-1" />Add Line</Button>
                  <div className="border-t pt-2 text-sm flex justify-between font-semibold"><span>Total</span><span>{formatCurrency(poTotal)}</span></div>
                </div>
              </div>
              <div className="space-y-2"><Label>Notes</Label><Textarea value={poForm.notes} onChange={e => setPOForm({ ...poForm, notes: e.target.value })} rows={2} /></div>
            </fieldset>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={savingPO} onClick={() => { setPODialog(false); if (poAttempt.unknown) void loadData() }}>{poAttempt.unknown ? 'Close and review list' : 'Cancel'}</Button>
              <Button type="submit" disabled={savingPO || !poForm.vendor_id}>{savingPO && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{poAttempt.unknown ? 'Retry original save' : 'Create PO'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {historyId&&<RecordHistoryDialog kind="vendor_bills" id={historyId} onClose={()=>setHistoryId(null)} />}
      <Dialog open={!!paymentBill} onOpenChange={open=>{if(!open&&!savingBill)setPaymentBill(null)}}><DialogContent><DialogHeader><DialogTitle>Record vendor bill payment</DialogTitle><DialogDescription>Record money already paid to the vendor. This does not initiate a transfer.</DialogDescription></DialogHeader><p>{paymentBill?.bill_number} · {paymentBill?.total} {paymentBill?.currency}</p><Label htmlFor="vendor-paid-on">Date paid</Label><Input id="vendor-paid-on" type="date" min={paymentBill?.issue_date} max={format(new Date(),'yyyy-MM-dd')} value={paidOn} onChange={event=>setPaidOn(event.target.value)} /><Button disabled={savingBill||!paidOn} onClick={async()=>{if(!paymentBill)return;setSavingBill(true);try{await markVendorBillPaid(paymentBill,paidOn);setPaymentBill(null);toast.success('Payment recorded');await loadData()}catch(error){toast.error(error instanceof Error?error.message:'Could not record payment')}finally{setSavingBill(false)}}}>Confirm payment record</Button></DialogContent></Dialog>
      {/* ── Delete Confirmation ── */}
      <AlertDialog open={deleteDialog} onOpenChange={setDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{deleteTarget?.type === 'vendor' ? 'Archive' : 'Cancel'} {deleteTarget?.type === 'vendor' ? 'Vendor' : deleteTarget?.type === 'bill' ? 'Bill' : 'Purchase Order'}</AlertDialogTitle><AlertDialogDescription>{deleteTarget?.type === 'bill' ? 'Cancel this bill and preserve its history?' : deleteTarget?.type === 'vendor' ? 'Archive this vendor and preserve linked records?' : `Cancel ${deleteTarget?.label}? The order and its history will be preserved.`}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground">Confirm</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// ROOT — route by account type
// ─────────────────────────────────────────────────────────────

export default function BillsPage() {
  const { hasCapability } = useAppState()
  const isAP = hasCapability(Capability.viewAccountsPayable)
  return isAP ? <AccountsPayableView /> : <PersonalBillsView />
}
