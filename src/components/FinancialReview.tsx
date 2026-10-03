'use client'
import { useState } from 'react'
import type { FinancialReview as Review } from '@/lib/financial-review/calculate'
import { demoPeriod } from '@/lib/financial-review/fixtures'
import { getSupabaseClient } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Period } from '@/lib/financial-review/contracts'

export function FinancialReview({ synthetic = false }: { synthetic?: boolean }) {
  const today = new Date().toISOString().slice(0, 10)
  const [period, setPeriod] = useState<Period>(synthetic ? demoPeriod : { start: today, end: today, currency: 'USD' })
  const [review, setReview] = useState<Review | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [view, setView] = useState<'findings' | 'unpaid' | 'obligations'>('findings')
  const [agentBusy, setAgentBusy] = useState(false), [agentNote, setAgentNote] = useState('')
  const [selected, setSelected] = useState<Review['findings'][number]['source'] | null>(null)
  async function load(selectedPeriod: Period) {
    setPeriod(selectedPeriod)
    setBusy(true); setError(''); setAgentNote(''); setReview(null); setSelected(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (!synthetic) {
        const { data } = await getSupabaseClient().auth.getSession()
        if (!data.session) throw new Error('Sign in to review your finances.')
        if (data.session.access_token) headers.Authorization = `Bearer ${data.session.access_token}`
      }
      const response = await fetch('/api/financial-review', { method: 'POST', headers, body: JSON.stringify(selectedPeriod), cache: 'no-store' })
      if (!response.ok) throw new Error(response.status === 404 ? 'Financial review is not enabled yet.' : 'Could not load the review. Check your dates and access, then try again.')
      setReview(await response.json())
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the review.') } finally { setBusy(false) }
  }
  async function prioritize() {
    if (!review) return
    setAgentBusy(true); setAgentNote('')
    try {
      const response = await fetch('/api/financial-review/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(review.period), cache: 'no-store' })
      if (!response.ok) throw new Error()
      const result = await response.json()
      setReview({ ...review, findings: result.findings })
      setAgentNote('Agent review complete. Findings are linked to verified sample records.')
    } catch { setAgentNote('The agent could not complete this review. Your original findings are still available.') }
    finally { setAgentBusy(false) }
  }
  const money = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: review?.period.currency || period.currency }).format(amount)
  return <section className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
    <header><p className="text-sm font-medium text-emerald-700">AMOUNTLY · FINANCIAL REVIEW</p><h1 className="mt-2 text-3xl font-bold">See what needs attention</h1><p className="mt-2 text-muted-foreground">Review your outstanding invoices, upcoming obligations, and expense records.</p>{synthetic && <p className="mt-2 text-sm text-amber-700">Synthetic sample · No connected account data</p>}</header>
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); const values=new FormData(e.currentTarget); void load({start:String(values.get('start')),end:String(values.get('end')),currency:String(values.get('currency')) as Period['currency']}) }}>
      <label className="grid gap-1 text-sm">From<input name="start" className="rounded border p-2" type="date" required value={period.start} onChange={e => setPeriod({ ...period, start: e.target.value })} /></label>
      <label className="grid gap-1 text-sm">Through<input name="end" className="rounded border p-2" type="date" required value={period.end} onChange={e => setPeriod({ ...period, end: e.target.value })} /></label>
      <label className="grid gap-1 text-sm">Currency<select name="currency" className="rounded border p-2" value={period.currency} onChange={e => setPeriod({ ...period, currency: e.target.value as Period['currency'] })}>{['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map(c => <option key={c}>{c}</option>)}</select></label>
      <Button disabled={busy || agentBusy}>{busy ? 'Reviewing…' : 'Review period'}</Button>
    </form><p className="text-sm text-muted-foreground">Choose up to 31 days. Current obligations cover the next seven days and past-due bills.</p>
    {error && <p role="alert">{error}</p>}{busy && <p role="status">Checking your records…</p>}
    {review && <><div className="grid gap-4 sm:grid-cols-3">{[['Unpaid invoices', review.totals.unpaid], ['Current obligations', review.totals.obligations], ['Period expenses', review.totals.expenses]].map(([label, amount]) => <Card key={label}><CardHeader><CardTitle className="text-sm font-normal">{label}</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{money(Number(amount))}</CardContent></Card>)}</div>
      <p className="text-sm text-muted-foreground">As of {review.asOf} · {review.period.start} through {review.period.end}</p>
      {synthetic && <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={agentBusy || busy} onClick={() => void prioritize()}>{agentBusy ? 'Agent reviewing…' : 'Review sample with agent'}</Button><p className="text-sm" role="status">{agentNote}</p></div>}
      <nav className="flex flex-wrap gap-2" aria-label="Review views">{(['findings', 'unpaid', 'obligations'] as const).map(v => <Button key={v} variant={v === view ? 'default' : 'outline'} aria-pressed={v === view} onClick={() => { setView(v); setSelected(null) }}>{v === 'findings' ? 'Findings' : v === 'unpaid' ? 'Unpaid invoices' : 'Upcoming bills'}</Button>)}</nav>
      <ul className="space-y-3">{review[view].map(row => <li key={'id' in row ? row.id : row.source.id} className="rounded-xl border bg-card p-5"><h2 className="font-semibold">{'title' in row ? row.title : row.source.label}</h2><p className="my-2 text-sm text-muted-foreground">{'detail' in row ? row.detail : `${money(row.amount)} · Due ${row.due}`}</p><Button size="sm" variant="outline" onClick={() => setSelected(row.source)}>Supporting record: {row.source.label}</Button></li>)}{!review[view].length && <li className="rounded border p-5">No matching records in this view.</li>}</ul>
      {selected && <Card><CardHeader><CardTitle>Supporting record · {selected.label}</CardTitle></CardHeader><CardContent>{review.findings.filter(f => f.source.id === selected.id).map(f => <p className="mt-3 text-sm" key={f.id}>{f.detail}</p>)}{!synthetic && <a className="mt-3 inline-block underline" href={selected.href}>Open source record</a>}<Button className="ml-3" size="sm" variant="ghost" onClick={() => setSelected(null)}>Close record</Button></CardContent></Card>}
      <div className="space-y-2 text-sm text-muted-foreground">{review.notes.map(note => <p key={note}>{note}</p>)}</div>
    </>}
  </section>
}
