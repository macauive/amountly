import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { mcpClient, mcpAuthError, privateHeaders } from '@/lib/chatgpt/auth'
import { createAmountlyMcp } from '@/lib/chatgpt/tools'
import { appOrigin } from '@/lib/platform/config'
import { chatgptEnabled, connectionScopes } from '@/lib/chatgpt/config'
import { AiHttpError } from '@/lib/ai/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
  if (!chatgptEnabled()) return Response.json({ error: 'Not found' }, { status: 404, headers: privateHeaders })
  try {
    const origin = request.headers.get('origin')
    if (origin && ![appOrigin(), 'https://chatgpt.com'].includes(origin)) throw new AiHttpError(403, 'Request not allowed')
    if (request.headers.get('sec-fetch-site') === 'cross-site' && origin !== 'https://chatgpt.com') throw new AiHttpError(403, 'Request not allowed')
    const server = createAmountlyMcp(await mcpClient(request))
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined,
      enableJsonResponse: true, maxRequestBodySize: 8192 })
    await server.connect(transport)
    try {
      const response = await transport.handleRequest(request)
      // JSON transport completes each bounded request before disposal.
      let body = await response.arrayBuffer()
      // The standard SDK preserves _meta; ChatGPT also requires this security
      // declaration on the top-level tool descriptor.
      if (response.headers.get('content-type')?.includes('application/json')) {
        const value = JSON.parse(new TextDecoder().decode(body))
        if (Array.isArray(value?.result?.tools)) {
          value.result.tools = value.result.tools.map((tool: Record<string, unknown>) => ({ ...tool,
            securitySchemes: [{ type: 'oauth2', scopes: [...connectionScopes] }] }))
          body = new TextEncoder().encode(JSON.stringify(value)).buffer
        }
      }
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(privateHeaders)) headers.set(key, value)
      return new Response(body.byteLength ? body : null, { status: response.status, headers })
    } finally { await server.close() }
  } catch (error) { return mcpAuthError(error) }
}
export async function GET(request: Request) {
  try { await mcpClient(request); return new Response(null, { status: 405, headers: { ...privateHeaders, Allow: 'POST' } }) }
  catch (error) { return mcpAuthError(error) }
}
