'use client'
import { useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase'
import type { summarizeRecord } from '@/lib/financial-review/service'
export function FinancialReviewRecord({ kind, id }: { kind: string; id: string }) {
  const [record, setRecord] = useState<ReturnType<typeof summarizeRecord> | null>(null), [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const { data } = await getSupabaseClient().auth.getSession()
        if (!data.session) throw new Error()
        const response = await fetch('/api/financial-review/record', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(data.session.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}) }, body: JSON.stringify({ kind, id }), cache: 'no-store' })
        if (!response.ok) throw new Error()
        const result = await response.json()
        if (active) setRecord(result)
      } catch { if (active) setError('This record is unavailable or outside your access.') }
    })()
    return () => { active = false }
  }, [kind, id])
  return <section className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-2xl font-semibold">Supporting financial record</h1>{error ? <p role="alert">{error}</p> : !record ? <p role="status">Loading record…</p> : <><h2>{record.label}</h2><p>Recorded amount: {record.amount.toFixed(2)} {record.currency} · {record.date} · Recorded status: {record.status}</p>{record.receiptAttached !== undefined && <p>{record.receiptAttached ? 'Receipt reference attached' : 'No receipt reference attached'}</p>}</>}<a href="/financial-review" className="underline">Back to financial review</a></section>
}
