'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { getInvoice, invoiceAction, recordInvoicePayment } from '@/services/invoices.service'
import type { Invoice, InvoicePayment } from '@/types/models'
import { Capability, InvoiceStatus, invoiceStatusLabels } from '@/types/enums'
import { useCapability } from '@/hooks/useCapability'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { formatDateOnly } from '@/lib/date-format'
import { format } from 'date-fns'
import { toast } from 'sonner'

const eventLabels: Record<string, string> = {
  created: 'Draft created', updated: 'Draft updated', issued: 'Invoice issued',
  payment_recorded: 'Payment recorded', cancelled: 'Invoice cancelled',
}

export default function InvoiceDetailPage() {
  const { id = '' } = useParams<{ id: string }>() ?? {}
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'issue' | 'cancel' | null>(null)
  const paymentId = useRef('')
  const paymentAttempt = useRef<Omit<InvoicePayment, 'invoice_id' | 'created_at'> | null>(null)
  const canRecord = useCapability(Capability.recordPayments)
  const canSend = useCapability(Capability.sendInvoices)
  const canEdit = useCapability(Capability.editInvoices)
  const load = useCallback(async () => {
    try { setError(''); setInvoice(await getInvoice(id)) }
    catch { setError('Could not load this invoice. Check your access and try again.') }
    finally { setLoading(false) }
  }, [id])
  useEffect(() => { void load() }, [load])

  async function applyAction() {
    if (!invoice || !confirmAction || busy) return
    setBusy(true)
    try {
      await invoiceAction(invoice, confirmAction)
      toast.success(confirmAction === 'issue' ? 'Invoice issued. No email was sent.' : 'Invoice cancelled; its history is preserved.')
      setConfirmAction(null)
      await load()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not update invoice.') }
    finally { setBusy(false) }
  }

  async function savePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!invoice || busy) return
    const form = new FormData(event.currentTarget)
    const payment = paymentAttempt.current ?? {
      id: paymentId.current, amount: Number(form.get('amount')), paid_on: String(form.get('paid_on')),
      method: String(form.get('method')) as InvoicePayment['method'], reference: String(form.get('reference') || ''),
    }
    paymentAttempt.current = payment
    setBusy(true)
    try {
      await recordInvoicePayment(invoice.id, payment)
      toast.success('Payment recorded')
      setPaymentOpen(false)
      paymentAttempt.current = null
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not confirm payment. Reload before retrying.')
      if (err && typeof err === 'object' && 'code' in err && err.code) {
        paymentAttempt.current = null
        paymentId.current = crypto.randomUUID()
      }
      await load()
    } finally { setBusy(false) }
  }

  if (loading) return <p className="p-6" role="status">Loading invoice…</p>
  if (error || !invoice) return <div className="p-6 space-y-4"><p role="alert">{error || 'Invoice not found.'}</p><Button onClick={load}>Try again</Button><Link href="/invoices">Back to invoices</Link></div>
  const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: invoice.currency }).format(value)
  const outstanding = invoice.status === InvoiceStatus.sent || invoice.status === InvoiceStatus.overdue
  const payments = invoice.payments ?? []

  return <div className="mx-auto max-w-5xl p-4 sm:p-6 space-y-6">
    <Link className="text-sm underline underline-offset-4" href="/invoices">← Invoices</Link>
    <div className="flex flex-wrap justify-between gap-4">
      <div><h1 className="text-2xl font-bold">{invoice.invoice_number}</h1><p className="text-muted-foreground">{invoice.client?.name || 'Client unavailable'}</p></div>
      <Badge className="self-start">{outstanding && payments.length > 0 ? `Partially paid${invoice.status === InvoiceStatus.overdue ? ' · Overdue' : ''}` : invoiceStatusLabels[invoice.status]}</Badge>
    </div>
    <div className="grid gap-4 sm:grid-cols-3">
      {[['Invoice total', invoice.total], ['Payments recorded', invoice.amount_paid ?? 0], ['Balance due', invoice.balance_due ?? invoice.total]].map(([label, amount]) => <Card key={label}><CardHeader className="pb-2"><CardTitle className="text-sm">{label}</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{money(Number(amount))}</CardContent></Card>)}
    </div>
    {invoice.status === InvoiceStatus.paid && payments.length === 0 && <p className="rounded-md border p-3 text-sm">This invoice was previously marked paid. No payment history was recorded; it is excluded from the new cash-received totals.</p>}
    <div className="flex flex-wrap gap-2">
      {invoice.status === InvoiceStatus.draft && canEdit && <Button variant="outline" asChild><Link href={`/invoices?edit=${invoice.id}`}>Edit draft</Link></Button>}
      {invoice.status === InvoiceStatus.draft && canSend && <Button disabled={busy} onClick={() => setConfirmAction('issue')}>Issue invoice</Button>}
      {outstanding && canRecord && <Button onClick={() => { if (!paymentAttempt.current) paymentId.current = crypto.randomUUID(); setPaymentOpen(true) }}>Record payment</Button>}
      {outstanding && canEdit && payments.length === 0 && <Button variant="outline" onClick={() => setConfirmAction('cancel')}>Cancel invoice</Button>}
    </div>
    <Card><CardHeader><CardTitle>Invoice details</CardTitle><p className="text-sm text-muted-foreground">Invoice date {formatDateOnly(invoice.issue_date)} · Due {formatDateOnly(invoice.due_date)} · {invoice.currency}</p></CardHeader><CardContent>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2">Description</th><th className="text-right px-3">Quantity</th><th className="text-right px-3">Rate</th><th className="text-right">Amount</th></tr></thead><tbody>{invoice.line_items?.slice().sort((a,b) => a.order-b.order).map(line => <tr className="border-b" key={line.id}><td className="py-3">{line.description}</td><td className="text-right px-3">{line.quantity}</td><td className="text-right px-3">{money(line.rate)}</td><td className="text-right">{money(line.amount)}</td></tr>)}</tbody></table></div>
      <div className="mt-4 space-y-1 text-right"><p>Subtotal {money(invoice.subtotal)}</p><p>Tax ({invoice.tax_rate}%) {money(invoice.tax_amount)}</p><p className="font-semibold">Total {money(invoice.total)}</p></div>
      {invoice.notes && <p className="mt-4 whitespace-pre-wrap text-sm">{invoice.notes}</p>}
      {invoice.status !== InvoiceStatus.draft && <p className="mt-4 text-sm text-muted-foreground">Issued details are locked to preserve the financial record.</p>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Payments</CardTitle></CardHeader><CardContent>{payments.length === 0 ? <p className="text-sm text-muted-foreground">No payments recorded.</p> : <ul className="divide-y">{payments.slice().sort((a,b) => b.paid_on.localeCompare(a.paid_on)).map(p => <li className="py-3 flex justify-between gap-4" key={p.id}><div><p>{formatDateOnly(p.paid_on)} · {p.method.replace('_',' ')}</p><p className="text-sm text-muted-foreground">{p.reference}</p></div><strong>{money(p.amount)}</strong></li>)}</ul>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Activity</CardTitle></CardHeader><CardContent><ul className="space-y-2 text-sm">{invoice.events?.slice().sort((a,b) => b.created_at.localeCompare(a.created_at)).map(event => <li key={event.id}>{eventLabels[event.action]} · {new Date(event.created_at).toLocaleString()}</li>)}</ul>{!invoice.events?.length && <p className="text-sm text-muted-foreground">Earlier activity was not recorded.</p>}</CardContent></Card>
    <Dialog open={paymentOpen} onOpenChange={open => { if (!busy) setPaymentOpen(open) }}><DialogContent><DialogHeader><DialogTitle>Record payment</DialogTitle><DialogDescription>Record money already received. This does not charge your client or transfer money.</DialogDescription></DialogHeader>
      <form onSubmit={savePayment} className="space-y-4">
        <fieldset disabled={busy || !!paymentAttempt.current} className="space-y-4">
        <div><Label htmlFor="payment_amount">Amount ({invoice.currency})</Label><Input id="payment_amount" name="amount" type="number" step="0.01" min="0.01" max={invoice.balance_due} defaultValue={paymentAttempt.current?.amount ?? invoice.balance_due} required /></div>
        <div><Label htmlFor="payment_date">Date received</Label><Input id="payment_date" name="paid_on" type="date" min={invoice.issue_date.slice(0,10)} max={format(new Date(),'yyyy-MM-dd')} defaultValue={paymentAttempt.current?.paid_on ?? format(new Date(),'yyyy-MM-dd')} required /></div>
        <div><Label htmlFor="payment_method">Method</Label><select id="payment_method" name="method" defaultValue={paymentAttempt.current?.method ?? 'bank_transfer'} className="w-full rounded-md border bg-background p-2"><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="check">Check</option><option value="other">Other</option></select></div>
        <div><Label htmlFor="payment_reference">Reference (optional)</Label><Input id="payment_reference" name="reference" defaultValue={paymentAttempt.current?.reference ?? ''} maxLength={200} placeholder="A short reference, without account numbers" /></div>
        </fieldset>
        <p className="text-xs text-muted-foreground">Payments are permanent records. Check the details before saving.</p>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : paymentAttempt.current ? 'Retry original payment' : 'Save payment'}</Button>
      </form>
    </DialogContent></Dialog>
    <Dialog open={!!confirmAction} onOpenChange={open => { if (!open && !busy) setConfirmAction(null) }}><DialogContent><DialogHeader><DialogTitle>{confirmAction === 'issue' ? 'Issue this invoice?' : 'Cancel this invoice?'}</DialogTitle><DialogDescription>{confirmAction === 'issue' ? 'Check the client, dates, and totals. Issuing locks these details. You will still need to send the invoice to your client.' : 'This preserves the invoice and its history, and removes it from outstanding balances.'}</DialogDescription></DialogHeader><Button disabled={busy} onClick={applyAction}>{busy ? 'Saving…' : 'Confirm'}</Button></DialogContent></Dialog>
  </div>
}
