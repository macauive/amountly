import { periodSchema } from '@/lib/financial-review/contracts'
import { createReviewReader } from '@/lib/financial-review/access'
import { safeReviewFailure } from '@/lib/financial-review/service'
import { readBoundedJson } from '@/lib/http'
import { AiHttpError } from '@/lib/ai/server'
export const runtime = 'nodejs'
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
  try {
    const read = await createReviewReader(request)
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return Response.json({ error: 'Expected JSON input.' }, { status: 415, headers })
    const input = periodSchema.safeParse(await readBoundedJson(request, 4096))
    if (!input.success) return Response.json({ error: 'Choose valid dates within 31 days and a supported currency.' }, { status: 400, headers })
    return Response.json(await read(input.data), { headers })
  } catch (error) {
    const failure = error instanceof AiHttpError ? { status: error.status, message: 'Invalid review request.' } : safeReviewFailure(error)
    return Response.json({ error: failure.message }, { status: failure.status, headers })
  }
}
