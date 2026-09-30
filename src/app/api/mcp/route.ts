import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createReviewMcp } from '@/lib/financial-review/mcp'
import { createReviewReader, createSourceReader } from '@/lib/financial-review/access'
import { periodSchema } from '@/lib/financial-review/contracts'
import { safeReviewFailure } from '@/lib/financial-review/service'
import { readBoundedJson } from '@/lib/http'
import { AiHttpError } from '@/lib/ai/server'
export const runtime = 'nodejs'
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
  let server: ReturnType<typeof createReviewMcp> | undefined
  try {
    const read = await createReviewReader(request)
    const body = await readBoundedJson(request, 8192)
    server = createReviewMcp(input => read(periodSchema.parse(input)), await createSourceReader(request))
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    const response = await transport.handleRequest(request, { parsedBody: body })
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value)
    return response
  } catch (error) {
    const failure = error instanceof AiHttpError ? { status: error.status, message: 'Invalid MCP request.' } : safeReviewFailure(error)
    return Response.json({ error: failure.message }, { status: failure.status, headers })
  } finally { await server?.close() }
}
export function GET() { return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } }) }
