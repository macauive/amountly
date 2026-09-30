import OpenAI from 'openai'
import { reviewMode } from '@/lib/financial-review/access'
import { syntheticSnapshot, demoDay } from '@/lib/financial-review/fixtures'
import { calculateReview } from '@/lib/financial-review/calculate'
import { periodSchema } from '@/lib/financial-review/contracts'
import { readBoundedJson } from '@/lib/http'
import { runSyntheticReviewAgent } from '@/lib/financial-review/agent'
export const runtime = 'nodejs'
export const maxDuration = 60
let running = false
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    // Customer-data execution is deliberately unavailable in this initial build.
    if (reviewMode(request) !== 'synthetic' || process.env.AMOUNTLY_SYNTHETIC_AGENT !== 'enabled') return Response.json({ error: 'Agent preview is not enabled.' }, { status: 404, headers })
    if (!process.env.OPENAI_API_KEY) return Response.json({ error: 'Agent preview needs local configuration.' }, { status: 503, headers })
    const input = periodSchema.safeParse(await readBoundedJson(request, 4096))
    if (!input.success) return Response.json({ error: 'Choose a valid review period.' }, { status: 400, headers })
    if (running) return Response.json({ error: 'A review is already running.' }, { status: 429, headers })
    running = true
    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 45000 })
      const review = calculateReview(syntheticSnapshot(), input.data, demoDay)
      const result = await runSyntheticReviewAgent(review, client, process.env.OPENAI_REVIEW_MODEL || process.env.OPENAI_MODEL || 'gpt-6-luna')
      return Response.json({ ...result, synthetic: true }, { headers })
    } finally { running = false }
  } catch { return Response.json({ error: 'The agent could not complete this review. Your deterministic findings are still available.' }, { status: 502, headers }) }
}
