'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { expenseHref, expenseNeedsReview } from '@/lib/expense-navigation'
import { useAuth } from '@/contexts/AuthContext'
import { getExpenses, getReceiptUrl } from '@/services/expenses.service'
import { getTimeEntries } from '@/services/time-entries.service'
import { getVendorBills } from '@/services/accounts-payable.service'
import { getBills } from '@/services/bills.service'
import { getLegacyPaidInvoices } from '@/services/invoices.service'
import { RecordSaveError, reviewWorkRecord, setExpenseReview } from '@/services/review.service'
import type { Expense, TimeEntry, Bill, VendorBill, Invoice } from '@/types/models'
import { isTimeReserved } from '@/components/TimeBillingDialog'
import { RecordHistoryDialog } from '@/components/RecordHistoryDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'

type ReviewRow = { kind: 'expenses' | 'time_entries'; record: Expense | TimeEntry }
type ReviewAction = 'submit' | 'approve' | 'reject' | 'mark-reviewed' | 'clear-review'

function expenseAmount(expense: Expense) {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: expense.currency }).format(expense.amount) }
  catch { return `${expense.amount} ${expense.currency}` }
}

export default function ReviewPage() {
  const { user } = useAuth()
  return <ReviewWorkspace key={`${user?.id ?? 'signed-out'}:${user?.organization_id ?? ''}:${user?.account_type ?? ''}:${user?.role ?? ''}`} />
}

function ReviewWorkspace() {
  const { user } = useAuth()
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [bills, setBills] = useState<(Bill | VendorBill)[]>([])
  const [legacyInvoices, setLegacyInvoices] = useState<Invoice[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState<(ReviewRow & { action: ReviewAction }) | null>(null)
  const [history, setHistory] = useState<ReviewRow | null>(null)
  const mounted = useRef(true)
  const loadVersion = useRef(0)
  const operation = useRef(false)
  const isSolo = user?.account_type === 'freelancer'
  const canSoloReview = isSolo && !user?.organization_id && user?.is_active !== false
  const canReview = user?.account_type === 'business' && ['OWNER', 'ADMIN'].includes(user.role)
  const canReviewLegacy = canReview || isSolo

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; loadVersion.current++ }
  }, [])

  const load = useCallback(async () => {
    if (!user || !mounted.current) return
    const version = ++loadVersion.current
    setLoading(true)
    setError('')
    try {
      const [expenses, time, billRows, legacyRows] = await Promise.all([
        getExpenses(),
        user.account_type === 'personal' ? Promise.resolve([]) : getTimeEntries(),
        user.account_type === 'personal' ? getBills() : getVendorBills(),
        canReviewLegacy ? getLegacyPaidInvoices() : Promise.resolve([]),
      ])
      if (!mounted.current || version !== loadVersion.current) return
      const expenseRows = expenses.map(record => ({ kind: 'expenses' as const, record }))
      const timeRows = time.filter(entry => !isTimeReserved(entry)).map(record => ({ kind: 'time_entries' as const, record }))
      setRows([...expenseRows, ...timeRows].filter(row => isSolo
        ? row.record.user_id === user.id && (['DRAFT', 'REJECTED'].includes(row.record.status)
          || (row.kind === 'expenses' && !!(row.record as Expense).reviewed_at))
        : ['DRAFT', 'REJECTED', 'SUBMITTED'].includes(row.record.status)))
      setBills(billRows.filter(bill => !['paid', 'cancelled'].includes(bill.status)))
      setLegacyInvoices(legacyRows)
    } catch {
      if (mounted.current && version === loadVersion.current) setError('Could not load the review inbox. Try again.')
    } finally {
      if (mounted.current && version === loadVersion.current) setLoading(false)
    }
  }, [user?.id, user?.organization_id, user?.account_type, canReviewLegacy, isSolo])

  useEffect(() => { void load(); return () => { loadVersion.current++ } }, [load])

  const own = rows.filter(row => row.record.user_id === user?.id && ['DRAFT', 'REJECTED'].includes(row.record.status))
  const pending = rows.filter(row => row.record.status === 'SUBMITTED')
  const soloExpenses = rows.filter(row => row.kind === 'expenses' && row.record.user_id === user?.id)
  const needsReview = soloExpenses.filter(row => expenseNeedsReview(row.record as Expense))
  const reviewed = soloExpenses.filter(row => !!(row.record as Expense).reviewed_at)
  const capturedTime = own.filter(row => row.kind === 'time_entries')

  const confirmReview = async () => {
    if (!confirmation || operation.current || !mounted.current) return
    const target = confirmation
    const soloAction = target.action === 'mark-reviewed' || target.action === 'clear-review'
    if (soloAction) {
      if (!canSoloReview || target.kind !== 'expenses' || target.record.user_id !== user?.id
        || !['DRAFT', 'REJECTED'].includes(target.record.status)) return
    } else if (target.action === 'submit') {
      if (user?.account_type !== 'business' || target.record.user_id !== user.id
        || !['DRAFT', 'REJECTED'].includes(target.record.status)) return
    } else if (!canReview || target.record.user_id === user?.id || target.record.status !== 'SUBMITTED') return
    operation.current = true
    setBusy(true)
    try {
      if (soloAction) await setExpenseReview(target.record.id, target.action === 'mark-reviewed', target.record.updated_at)
      else await reviewWorkRecord(target.kind, target.record.id, target.action as 'submit' | 'approve' | 'reject', target.record.updated_at)
      if (!mounted.current) return
      setConfirmation(null)
      await load()
      if (mounted.current) toast.success(soloAction ? target.action === 'mark-reviewed' ? 'Expense marked reviewed' : 'Expense review cleared' : 'Review recorded')
    } catch (failure) {
      if (!mounted.current) return
      setConfirmation(null)
      await load()
      if (mounted.current) toast.error(failure instanceof RecordSaveError ? failure.message : 'Could not confirm the review. Reload and check the current record before trying again.')
    } finally {
      operation.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const cards = (items: ReviewRow[]) => items.map(row => {
    const expense = row.kind === 'expenses' ? row.record as Expense : null
    const entry = row.record as TimeEntry
    const canMark = canSoloReview && !!expense && expense.user_id === user?.id && ['DRAFT', 'REJECTED'].includes(expense.status)
    return <li key={`${row.kind}-${row.record.id}`} className="flex flex-wrap justify-between gap-3 border-b py-3">
      <div>
        <p className="font-medium">{expense ? expense.description || expense.merchant || 'Expense' : entry.notes || 'Tracked time'}</p>
        <p className="text-sm text-muted-foreground">{expense ? expenseAmount(expense) : `${entry.duration_minutes} minutes · ${entry.project?.name || 'No project'}`} · {row.record.status.toLowerCase()}</p>
        {isSolo && expense && <Badge variant={expense.reviewed_at ? 'secondary' : 'outline'} className="mt-1">{expense.reviewed_at ? 'Reviewed' : 'Needs review'}</Badge>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setHistory(row)}>History</Button>
        <Button variant="outline" size="sm" asChild><Link href={expense ? expenseHref(expense.id) : '/time-entries'}>Open</Link></Button>
        {expense && (expense.receipt_path || expense.receipt_url) && <Button variant="ghost" size="sm" onClick={async () => {
          try { const url = await getReceiptUrl(expense); if (mounted.current) window.open(url, '_blank', 'noopener,noreferrer') }
          catch { if (mounted.current) toast.error('Could not open receipt. Check your access and try again.') }
        }}>Receipt</Button>}
        {canMark ? <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmation({ ...row, action: expense.reviewed_at ? 'clear-review' : 'mark-reviewed' })}>{expense.reviewed_at ? 'Clear review' : 'Mark reviewed'}</Button>
          : row.record.status === 'SUBMITTED' && canReview && row.record.user_id !== user?.id ? <>
            <Button size="sm" disabled={busy} onClick={() => setConfirmation({ ...row, action: 'approve' })}>Approve</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmation({ ...row, action: 'reject' })}>Reject</Button>
          </> : row.record.user_id === user?.id && ['DRAFT', 'REJECTED'].includes(row.record.status) && user?.account_type === 'business'
            ? <Button size="sm" disabled={busy} onClick={() => setConfirmation({ ...row, action: 'submit' })}>Submit for review</Button> : null}
      </div>
    </li>
  })
  const soloConfirmation = confirmation?.action === 'mark-reviewed' || confirmation?.action === 'clear-review'
  if (loading) return <p className="p-6" role="status">Loading review inbox…</p>
  return <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
    <div>
      <h1 className="text-2xl font-bold">Review inbox</h1>
      <Button className="my-3" variant="outline" asChild><Link href="/financial-review">Open financial review</Link></Button>
      <p className="text-muted-foreground">{isSolo
        ? 'Check your saved expense details and receipts, then mark them reviewed. Needs review counts your draft and rejected expenses; edits require another review.'
        : 'Review captured expenses and time, then follow up on bills. Approvals require a different owner or administrator.'}</p>
    </div>
    {error ? <div role="alert">{error}<Button onClick={load}>Try again</Button></div> : <>
      {isSolo ? <>
        <Card><CardHeader><CardTitle>Needs review ({needsReview.length})</CardTitle></CardHeader><CardContent><ul>{cards(needsReview)}</ul>{!needsReview.length && <p>No saved drafts or rejected expenses need review.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Reviewed ({reviewed.length})</CardTitle></CardHeader><CardContent><p className="mb-3 text-sm text-muted-foreground">These saved expenses have been reviewed. Their financial status is shown on each record.</p><ul>{cards(reviewed)}</ul>{!reviewed.length && <p>No reviewed expenses yet.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Captured time ({capturedTime.length})</CardTitle></CardHeader><CardContent><ul>{cards(capturedTime)}</ul>{!capturedTime.length && <p>No draft or rejected time entries.</p>}</CardContent></Card>
      </> : <>
        <Card><CardHeader><CardTitle>Your captured records ({own.length})</CardTitle></CardHeader><CardContent><ul>{cards(own)}</ul>{!own.length && <p>No drafts or rejected records to review.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Submitted for review ({pending.length})</CardTitle></CardHeader><CardContent><ul>{cards(pending)}</ul>{!pending.length && <p>No submitted records.</p>}</CardContent></Card>
      </>}
      <Card><CardHeader><CardTitle>Open {user?.account_type === 'personal' ? 'personal' : 'vendor'} bills ({bills.length})</CardTitle></CardHeader><CardContent><p className="text-sm">{bills.filter(bill => bill.due_date < new Date().toISOString().slice(0, 10)).length} past due. Payment records and cancellation are managed on Bills.</p><Button className="mt-3" variant="outline" asChild><Link href="/bills">Review bills</Link></Button></CardContent></Card>
      {canReviewLegacy && <Card><CardHeader><CardTitle>Historical payments to verify ({legacyInvoices.length})</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">These invoices were marked Paid without recorded receipts. Review evidence before including them in cash totals.</p><ul>{legacyInvoices.map(invoice => <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-3"><span>{invoice.invoice_number} · {invoice.total} {invoice.currency}</span><Button variant="outline" size="sm" asChild><Link href={`/invoices/${invoice.id}`}>Review payment evidence</Link></Button></li>)}</ul>{!legacyInvoices.length && <p className="mt-3 text-sm">No historical payments awaiting review.</p>}</CardContent></Card>}
    </>}
    {history && <RecordHistoryDialog kind={history.kind} id={history.record.id} onClose={() => setHistory(null)} />}
    <Dialog open={!!confirmation} onOpenChange={open => { if (!open && !operation.current) setConfirmation(null) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{soloConfirmation ? confirmation?.action === 'mark-reviewed' ? 'Mark expense reviewed?' : 'Clear expense review?' : `Confirm ${confirmation?.action ?? 'review'}`}</DialogTitle>
          <DialogDescription>{soloConfirmation
            ? confirmation?.action === 'mark-reviewed' ? 'Check the saved amount, currency, date, category and receipt. This review will be recorded in the expense history.' : 'Clear the reviewed label so this saved expense needs review again. The change will be recorded in its history.'
            : 'Check the record before continuing. The status change will be recorded in its history.'}</DialogDescription>
        </DialogHeader>
        {confirmation && <div className="rounded border p-3 text-sm"><p className="font-medium">{confirmation.kind === 'expenses' ? (confirmation.record as Expense).description || (confirmation.record as Expense).merchant || 'Expense' : (confirmation.record as TimeEntry).notes || 'Tracked time'}</p><p>{confirmation.kind === 'expenses' ? `${(confirmation.record as Expense).amount} ${(confirmation.record as Expense).currency}` : `${(confirmation.record as TimeEntry).duration_minutes} minutes`} · {confirmation.record.status.toLowerCase()}</p></div>}
        <Button disabled={busy} onClick={confirmReview}>{busy ? 'Saving…' : soloConfirmation ? confirmation?.action === 'mark-reviewed' ? 'Confirm mark reviewed' : 'Confirm clear review' : 'Confirm'}</Button>
      </DialogContent>
    </Dialog>
  </div>
}
