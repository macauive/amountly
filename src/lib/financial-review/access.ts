import { authorizeAiRequest, AiHttpError } from '@/lib/ai/server'
import { ReviewError, type Period } from '@/lib/financial-review/contracts'
import { calculateReview } from '@/lib/financial-review/calculate'
import { reviewForClient } from '@/lib/financial-review/service'
import { syntheticSnapshot, demoDay } from '@/lib/financial-review/fixtures'

export function reviewMode(request: Request): 'synthetic' | 'account' {
  const url = new URL(request.url), mode = process.env.AMOUNTLY_REVIEW_MODE
  if (mode === 'synthetic' && process.env.NODE_ENV === 'development' && url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    // Synthetic bypass is loopback development only. Deny cross-origin browser use.
    const origin = request.headers.get('origin')
    if (origin && origin !== url.origin) throw new ReviewError(403)
    return 'synthetic'
  }
  if (mode === 'account') return 'account'
  throw new ReviewError(404, 'Financial review is not enabled.')
}
export async function createReviewReader(request: Request) {
  const mode = reviewMode(request)
  if (mode === 'synthetic') return async (period: Period) => ({ ...calculateReview(syntheticSnapshot(), period, demoDay), synthetic: true })
  let client
  try { client = await authorizeAiRequest(request) }
  catch (error) { throw new ReviewError(error instanceof AiHttpError ? error.status : 503) }
  return async (period: Period) => ({ ...await reviewForClient(client, period, new Date().toISOString().slice(0, 10)), synthetic: false })
}

export async function createSourceReader(request: Request) {
  const { recordQuerySchema, readSourceRecord, summarizeRecord } = await import('@/lib/financial-review/service')
  if (reviewMode(request) === 'synthetic') return async (input: unknown) => {
    const query = recordQuerySchema.parse(input), snapshot = syntheticSnapshot()
    const records = query.kind === 'invoices' ? snapshot.invoices : query.kind === 'expenses' ? snapshot.expenses : snapshot.bills.filter(b => b.kind === query.kind)
    const record = records.find(r => r.id === query.id)
    if (!record) throw new ReviewError(404, 'This record is unavailable.')
    return summarizeRecord(query.kind, record)
  }
  const client = await authorizeAiRequest(request)
  return (input: unknown) => readSourceRecord(client, input)
}
