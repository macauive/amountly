'use client'

import { useState } from 'react'
import type { Invoice, InvoicePayment } from '@/types/models'
import { reviewLegacyPayment, type LegacyPaymentReviewInput } from '@/services/invoices.service'
import { useCreateAttempt } from '@/hooks/useCreateAttempt'
import { SaveAttemptNotice } from '@/components/SaveAttemptNotice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { format } from 'date-fns'
import { toast } from 'sonner'

export function LegacyPaymentReviewDialog({ invoice, open, onClose, onSaved }: {
  invoice: Invoice; open: boolean; onClose: () => void; onSaved: () => Promise<void>
}) {
  const [action, setAction] = useState<'record_payment' | 'reopen'>('record_payment')
  const [busy, setBusy] = useState(false)
  const attempt = useCreateAttempt<{ invoice: Pick<Invoice, 'id' | 'updated_at'>; review: LegacyPaymentReviewInput }>()
  const original = attempt.input?.review
  const payment = original?.action === 'record_payment' ? original : undefined
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const data = new FormData(event.currentTarget)
    const evidence = String(data.get('evidence') ?? '').trim()
    const review: LegacyPaymentReviewInput = action === 'reopen' ? { action, evidence } : {
      action, evidence, amount: Number(data.get('amount')), paid_on: String(data.get('paid_on')),
      method: String(data.get('method')) as InvoicePayment['method'], reference: String(data.get('reference') ?? ''),
    }
    setBusy(true)
    try {
      await attempt.run({ invoice: { id: invoice.id, updated_at: invoice.updated_at }, review }, (original, id) => reviewLegacyPayment(original.invoice, original.review, id))
      toast.success('Legacy payment review recorded; original history preserved.')
      await onSaved()
      onClose()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not confirm review.') }
    finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={open => { if (!open && !busy) onClose() }}><DialogContent className="max-h-[90dvh] overflow-y-auto">
    <DialogHeader><DialogTitle>Review historical payment</DialogTitle><DialogDescription>The old Paid label is not payment evidence. Record only money you can verify, or reopen an unsupported balance. This does not transfer money or contact your client.</DialogDescription></DialogHeader>
    <p className="text-sm">{invoice.invoice_number} · Invoice total {invoice.total} {invoice.currency}</p>
    <form onSubmit={submit} className="space-y-4">
      <SaveAttemptNotice message={attempt.message} />
      <fieldset disabled={busy || attempt.unknown} className="space-y-4">
        <div><Label htmlFor="legacy-action">Review outcome</Label><select id="legacy-action" value={action} onChange={event => setAction(event.target.value as typeof action)} className="w-full rounded border bg-background p-2"><option value="record_payment">Record a verified historical payment</option><option value="reopen">Reopen without recording a payment</option></select></div>
        {action === 'record_payment' && <>
          <div><Label htmlFor="legacy-amount">Verified amount ({invoice.currency})</Label><Input id="legacy-amount" name="amount" type="number" min="0.01" step="0.01" max={invoice.total} defaultValue={payment?.amount} required /></div>
          <div><Label htmlFor="legacy-date">Date actually received</Label><Input id="legacy-date" name="paid_on" type="date" min={invoice.issue_date.slice(0,10)} max={format(new Date(),'yyyy-MM-dd')} defaultValue={payment?.paid_on} required /></div>
          <div><Label htmlFor="legacy-method">Payment method</Label><select id="legacy-method" name="method" required defaultValue={payment?.method ?? ''} className="w-full rounded border bg-background p-2"><option value="" disabled>Select verified method</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="check">Check</option><option value="other">Other</option></select></div>
          <div><Label htmlFor="legacy-reference">Reference (optional)</Label><Input id="legacy-reference" name="reference" maxLength={200} defaultValue={payment?.reference} /></div>
        </>}
        <div><Label htmlFor="legacy-evidence">Evidence reviewed and reason</Label><Textarea id="legacy-evidence" name="evidence" minLength={10} maxLength={1000} defaultValue={original?.evidence} required placeholder="Describe the record checked and why this outcome is correct. Do not include account or card numbers." /></div>
        <p className="text-sm text-muted-foreground">This review is permanent. The original Paid status/date and your explanation remain available. Partial evidence reopens the unpaid remainder.</p>
      </fieldset>
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : attempt.unknown ? 'Retry original review' : 'Confirm reviewed evidence'}</Button>
    </form>
  </DialogContent></Dialog>
}
