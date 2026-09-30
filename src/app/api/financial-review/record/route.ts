import { createSourceReader } from '@/lib/financial-review/access'
import { safeReviewFailure } from '@/lib/financial-review/service'
import { readBoundedJson } from '@/lib/http'
import { AiHttpError } from '@/lib/ai/server'
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    const read = await createSourceReader(request)
    return Response.json(await read(await readBoundedJson(request, 2048)), { headers })
  } catch (error) {
    const failure = error instanceof AiHttpError ? { status: error.status, message: 'Could not open this record.' } : safeReviewFailure(error)
    return Response.json({ error: failure.message }, { status: failure.status, headers })
  }
}
