import { z } from 'zod'
import { ReviewError } from '@/lib/financial-review/contracts'
import type { FinancialReview } from '@/lib/financial-review/calculate'

export const reviewEventSchema = z.object({ id: z.string().uuid(), accountId: z.string().uuid(),
  kind: z.enum(['invoices', 'bills', 'vendor_bills', 'expenses']), recordId: z.string().uuid(),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict()
export type FollowThroughState = { accountId: string; enabled: boolean; seen: string[]; versions: Record<string, number>;
  drafts: { id: string; sourceId: string; title: string; body: string; status: 'needs_review' }[] }
// Application-event reducer, not MCP Events. The caller authenticates the event,
// reloads authorized records, and commits this state atomically with its cursor.
export function prepareFollowThrough(state: FollowThroughState, eventInput: unknown, review: FinancialReview): FollowThroughState {
  const event = reviewEventSchema.parse(eventInput)
  if (event.accountId !== state.accountId) throw new ReviewError(403)
  if (!state.enabled || state.seen.includes(event.id)) return state
  const key = `${event.kind}:${event.recordId}`
  if ((state.versions[key] ?? 0) >= event.version) return state
  if (state.seen.length >= 5000) throw new ReviewError(413, 'Follow-through history requires archival before processing more changes.')
  const findings = review.findings.filter(f => f.source.id === event.recordId && f.source.kind === event.kind)
  const versions = { ...state.versions, [key]: event.version }
  const drafts = state.drafts.filter(d => d.sourceId !== key)
  if (findings.length) drafts.push({ id: event.id, sourceId: key, title: 'Review a financial change', status: 'needs_review',
    body: findings.map(f => `${f.title}: ${f.detail}`).join('\n') })
  return { ...state, seen: [...state.seen, event.id], versions, drafts }
}
