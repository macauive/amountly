'use client'

import { useRef, useState } from 'react'
import { reverseInvoicePayment } from '@/services/invoices.service'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'

export function PaymentCorrectionDialog({ paymentId, onClose, onSaved }: {
  paymentId: string; onClose: () => void; onSaved: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const attempt = useRef<{ id: string; reason: string } | null>(null)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    attempt.current ??= { id: crypto.randomUUID(), reason: reason.trim() }
    setBusy(true)
    try {
      await reverseInvoicePayment(attempt.current.id, paymentId, attempt.current.reason)
      toast.success('Payment corrected. The original entry and reason remain in history.')
      await onSaved()
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not confirm the correction. Reload before retrying.')
      if (error && typeof error === 'object' && 'code' in error && error.code) attempt.current = null
      await onSaved()
    } finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}><DialogContent>
    <DialogHeader><DialogTitle>Correct a recorded payment</DialogTitle><DialogDescription>
      Use this only for an entry recorded incorrectly. The full amount will be excluded from payment totals and the invoice balance will reopen. This does not send a refund. You can record the correct payment afterward.
    </DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-4">
      <div><Label htmlFor="correction-reason">Reason for correction</Label><Textarea id="correction-reason" required minLength={5} maxLength={500} value={reason} disabled={busy || !!attempt.current} onChange={event => setReason(event.target.value)} /></div>
      <p className="text-sm text-muted-foreground">The original payment and this reason will be preserved. Do not include bank or card details.</p>
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : attempt.current ? 'Retry original correction' : 'Confirm correction'}</Button>
    </form>
  </DialogContent></Dialog>
}
