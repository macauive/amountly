'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { expenseHref } from '@/lib/expense-navigation'
import { useAuth } from '@/contexts/AuthContext'
import { getExpenses } from '@/services/expenses.service'
import { getTimeEntries } from '@/services/time-entries.service'
import { getVendorBills } from '@/services/accounts-payable.service'
import { getBills } from '@/services/bills.service'
import { getLegacyPaidInvoices } from '@/services/invoices.service'
import { reviewWorkRecord } from '@/services/review.service'
import type { Expense, TimeEntry, Bill, VendorBill, Invoice } from '@/types/models'
import { isTimeReserved } from '@/components/TimeBillingDialog'
import { RecordHistoryDialog } from '@/components/RecordHistoryDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'

type ReviewRow = { kind: 'expenses' | 'time_entries'; record: Expense | TimeEntry }
export default function ReviewPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [bills, setBills] = useState<(Bill | VendorBill)[]>([])
  const [legacyInvoices, setLegacyInvoices] = useState<Invoice[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState<(ReviewRow & { action: 'submit' | 'approve' | 'reject' }) | null>(null)
  const [history, setHistory] = useState<ReviewRow | null>(null)
  const canReview = user?.account_type === 'business' && ['OWNER', 'ADMIN'].includes(user.role)
  const canReviewLegacy = canReview || user?.account_type === 'freelancer'
  const load = useCallback(async () => {
    if (!user) return
    try {
      setError('')
      const [expenses, time, billRows, legacyRows] = await Promise.all([getExpenses(), user.account_type === 'personal' ? Promise.resolve([]) : getTimeEntries(), user.account_type === 'personal' ? getBills() : getVendorBills(), canReviewLegacy ? getLegacyPaidInvoices() : Promise.resolve([])])
      setRows([...expenses.map(record => ({ kind: 'expenses' as const, record })), ...time.filter(entry => !isTimeReserved(entry)).map(record => ({ kind: 'time_entries' as const, record }))].filter(row => ['DRAFT', 'REJECTED', 'SUBMITTED'].includes(row.record.status)))
      setBills(billRows.filter(bill => !['paid', 'cancelled'].includes(bill.status)))
      setLegacyInvoices(legacyRows)
    } catch { setError('Could not load the review inbox. Try again.') } finally { setLoading(false) }
  }, [user?.id, user?.organization_id, user?.account_type, canReviewLegacy])
  useEffect(() => { void load() }, [load])
  const own = rows.filter(row => row.record.user_id === user?.id && ['DRAFT', 'REJECTED'].includes(row.record.status))
  const pending = rows.filter(row => row.record.status === 'SUBMITTED')
  const cards = (items: ReviewRow[]) => items.map(row => {
    const expense = row.kind === 'expenses' ? row.record as Expense : null
    const entry = row.record as TimeEntry
    return <li key={`${row.kind}-${row.record.id}`} className="flex flex-wrap justify-between gap-3 border-b py-3"><div><p className="font-medium">{expense ? expense.description || expense.merchant || 'Expense' : entry.notes || 'Tracked time'}</p><p className="text-sm text-muted-foreground">{expense ? new Intl.NumberFormat('en-US', { style: 'currency', currency: expense.currency }).format(expense.amount) : `${entry.duration_minutes} minutes · ${entry.project?.name || 'No project'}`} · {row.record.status.toLowerCase()}</p></div><div className="flex flex-wrap items-center gap-2"><Button variant="ghost" size="sm" onClick={() => setHistory(row)}>History</Button><Button variant="outline" size="sm" asChild><Link href={expense ? expenseHref(expense.id) : '/time-entries'}>Open</Link></Button>{row.record.status === 'SUBMITTED' && canReview && row.record.user_id !== user?.id ? <><Button size="sm" onClick={() => setConfirmation({ ...row, action: 'approve' })}>Approve</Button><Button size="sm" variant="outline" onClick={() => setConfirmation({ ...row, action: 'reject' })}>Reject</Button></> : row.record.user_id === user?.id && ['DRAFT', 'REJECTED'].includes(row.record.status) && user?.account_type === 'business' ? <Button size="sm" onClick={() => setConfirmation({ ...row, action: 'submit' })}>Submit for review</Button> : null}</div></li>
  })
  if (loading) return <p className="p-6" role="status">Loading review inbox…</p>
  return <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6"><div><h1 className="text-2xl font-bold">Review inbox</h1><Button className="my-3" variant="outline" asChild><Link href="/financial-review">Open financial review</Link></Button><p className="text-muted-foreground">Review captured expenses and time, then follow up on bills. Approvals require a different owner or administrator.</p></div>{error ? <div role="alert">{error}<Button onClick={load}>Try again</Button></div> : <>
    <Card><CardHeader><CardTitle>Your captured records ({own.length})</CardTitle></CardHeader><CardContent><ul>{cards(own)}</ul>{!own.length && <p>No drafts or rejected records to review.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Submitted for review ({pending.length})</CardTitle></CardHeader><CardContent><ul>{cards(pending)}</ul>{!pending.length && <p>No submitted records.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Open {user?.account_type === 'personal' ? 'personal' : 'vendor'} bills ({bills.length})</CardTitle></CardHeader><CardContent><p className="text-sm">{bills.filter(bill => bill.due_date < new Date().toISOString().slice(0, 10)).length} past due. Payment records and cancellation are managed on Bills.</p><Button className="mt-3" variant="outline" asChild><Link href="/bills">Review bills</Link></Button></CardContent></Card>
    {canReviewLegacy && <Card><CardHeader><CardTitle>Historical payments to verify ({legacyInvoices.length})</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">These invoices were marked Paid without recorded receipts. Review evidence before including them in cash totals.</p><ul>{legacyInvoices.map(invoice => <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-3"><span>{invoice.invoice_number} · {invoice.total} {invoice.currency}</span><Button variant="outline" size="sm" asChild><Link href={`/invoices/${invoice.id}`}>Review payment evidence</Link></Button></li>)}</ul>{!legacyInvoices.length && <p className="mt-3 text-sm">No historical payments awaiting review.</p>}</CardContent></Card>}
  </>}{history && <RecordHistoryDialog kind={history.kind} id={history.record.id} onClose={() => setHistory(null)} />}
    <Dialog open={!!confirmation} onOpenChange={open => { if (!open && !busy) setConfirmation(null) }}><DialogContent><DialogHeader><DialogTitle>Confirm {confirmation?.action}</DialogTitle><DialogDescription>Check the record before continuing. The status change will be recorded in its history.</DialogDescription></DialogHeader>{confirmation && <div className="rounded border p-3 text-sm"><p className="font-medium">{confirmation.kind === 'expenses' ? (confirmation.record as Expense).description || (confirmation.record as Expense).merchant || 'Expense' : (confirmation.record as TimeEntry).notes || 'Tracked time'}</p><p>{confirmation.kind === 'expenses' ? `${(confirmation.record as Expense).amount} ${(confirmation.record as Expense).currency}` : `${(confirmation.record as TimeEntry).duration_minutes} minutes`} · {confirmation.record.status.toLowerCase()}</p></div>}<Button disabled={busy} onClick={async () => { if (!confirmation) return; setBusy(true); try { await reviewWorkRecord(confirmation.kind, confirmation.record.id, confirmation.action, confirmation.record.updated_at); setConfirmation(null); await load(); toast.success('Review recorded') } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not review record') } finally { setBusy(false) } }}>{busy ? 'Saving…' : 'Confirm'}</Button></DialogContent></Dialog>
  </div>
}
