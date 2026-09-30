import type { Snapshot } from '@/lib/financial-review/contracts'
export const demoDay = '2026-09-29'
export const demoPeriod = { start: '2026-09-28', end: '2026-10-04', currency: 'USD' as const }
export const syntheticId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const owner = { user_id: syntheticId(1), organization_id: null }
export function syntheticSnapshot(): Snapshot {
  return {
    invoices: [{ ...owner, id: syntheticId(10), invoice_number: 'DEMO-1042', total: 1250, currency: 'USD', issue_date: '2026-09-01', due_date: '2026-09-25', status: 'SENT' },
      { ...owner, id: syntheticId(11), invoice_number: 'DEMO-1043', total: 800, currency: 'USD', issue_date: '2026-09-20', due_date: '2026-10-02', status: 'SENT' }],
    payments: [{ id: syntheticId(20), invoice_id: syntheticId(10), amount: 250, reversal: null }],
    bills: [{ ...owner, id: syntheticId(30), name: 'Demo studio rent', amount: 900, currency: 'USD', due_date: '2026-10-01', status: 'upcoming', kind: 'bills' },
      { ...owner, id: syntheticId(31), name: 'Demo internet', amount: 65, currency: 'USD', due_date: '2026-09-28', status: 'upcoming', kind: 'bills' }],
    expenses: [40, 41, 42, 43].map((n, i) => ({ ...owner, id: syntheticId(n), description: i === 3 ? 'Demo equipment purchase' : 'Demo office supplies', amount: i === 3 ? 420 : 35 + i * 5,
      currency: 'USD', expense_date: i === 3 ? '2026-09-29' : `2026-08-${10 + i}`, category: 'office', status: 'APPROVED',
      receipt_path: i === 3 ? null : 'synthetic-reference', receipt_url: null, archived_at: null })),
  }
}
