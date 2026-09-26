'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import type { Project, TimeEntry } from '@/types/models'
import { createInvoiceFromTime } from '@/services/invoices.service'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'

export function isTimeReserved(entry: TimeEntry) {
  return !!entry.invoice_id || !!entry.billing_links?.some(link => !link.released_at)
}

export function TimeBillingDialog({ entries, projects, business, onClose }: {
  entries: TimeEntry[]; projects: Project[]; business: boolean; onClose: () => void
}) {
  const router = useRouter()
  const [projectId, setProjectId] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [currency, setCurrency] = useState('USD')
  const [busy, setBusy] = useState(false)
  const attempt = useRef<{ id: string; ids: string[]; data: Parameters<typeof createInvoiceFromTime>[2] } | null>(null)
  const eligible = entries.filter(entry => entry.project_id === projectId && !isTimeReserved(entry) &&
    (business ? entry.status === 'APPROVED' : ['DRAFT','SUBMITTED','APPROVED'].includes(entry.status)) &&
    Number(entry.billable_rate) > 0 && Number(entry.duration_minutes) > 0 && entry.end_at)
  const cents = eligible.filter(entry => selected.includes(entry.id)).reduce((sum, entry) =>
    sum + Math.round(Number(entry.duration_minutes) * Math.round(Number(entry.billable_rate) * 100) / 60), 0)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const project = projects.find(item => item.id === projectId)
    if (!attempt.current && (!project?.client_id || selected.length === 0)) return
    attempt.current ??= { id: crypto.randomUUID(), ids: [...selected], data: {
      project_id: projectId, client_id: project!.client_id!, currency,
      issue_date: String(form.get('issue_date')), due_date: String(form.get('due_date')), tax_rate: Number(form.get('tax_rate')),
    } }
    setBusy(true)
    try {
      const id = await createInvoiceFromTime(attempt.current.id, attempt.current.ids, attempt.current.data)
      toast.success('Draft created and time reserved. Review it before issuing.')
      router.push(`/invoices/${id}`)
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not confirm draft. Retry the original request.')
      if (error && typeof error === 'object' && 'code' in error && error.code) attempt.current = null
    } finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>Invoice tracked time</DialogTitle><DialogDescription>Select work from one project. Business entries need independent approval; each entry needs an hourly rate. Reserved work cannot be billed again.</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={busy || !!attempt.current} className="space-y-4">
        <div><Label htmlFor="billing-project">Project</Label><select id="billing-project" required className="w-full rounded border bg-background p-2" value={projectId} onChange={event => { setProjectId(event.target.value); setSelected([]) }}><option value="">Choose a project with a client</option>{projects.filter(project => project.client_id).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div>
        <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="time-currency">Currency</Label><select id="time-currency" value={currency} onChange={event => setCurrency(event.target.value)} className="w-full rounded border bg-background p-2">{['USD','EUR','GBP','CAD','AUD'].map(code => <option key={code}>{code}</option>)}</select></div><div><Label htmlFor="time-tax">Tax (%)</Label><Input id="time-tax" name="tax_rate" type="number" min="0" max="100" step="0.01" defaultValue="0" required /></div></div>
        <p className="text-sm text-muted-foreground">The currency applies to all selected hourly rates. Confirm the rates were entered in this currency.</p>
        <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="time-issue">Invoice date</Label><Input id="time-issue" name="issue_date" type="date" defaultValue={format(new Date(),'yyyy-MM-dd')} required /></div><div><Label htmlFor="time-due">Due date</Label><Input id="time-due" name="due_date" type="date" defaultValue={format(new Date(),'yyyy-MM-dd')} required /></div></div>
        <div className="max-h-60 space-y-2 overflow-y-auto rounded border p-3">
          {!eligible.length && <p className="text-sm">No eligible unbilled time for this project. Check rates, approval, and existing reservations.</p>}
          {eligible.map(entry => <label key={entry.id} className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={selected.includes(entry.id)} disabled={selected.length >= 100 && !selected.includes(entry.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous,entry.id] : previous.filter(id => id !== entry.id))} /><span>{format(new Date(entry.start_at),'MMM d, yyyy')} · {entry.duration_minutes} min · {entry.billable_rate}/hr — {entry.notes || 'Tracked work'}</span></label>)}
        </div>
      </fieldset>
      <p className="font-medium">{selected.length} entries · Subtotal {new Intl.NumberFormat('en-US',{style:'currency',currency}).format(cents/100)}</p>
      <p className="text-sm text-muted-foreground">Charges use exact minutes, rounded to cents per entry. Time drafts have fixed lines; deleting the draft releases its entries.</p>
      <Button type="submit" disabled={busy || (!attempt.current && !selected.length)}>{busy ? 'Creating…' : attempt.current ? 'Retry original request' : 'Create draft and reserve time'}</Button>
    </form>
  </DialogContent></Dialog>
}
