import { getAuth } from '@/lib/platform/auth'
import { recordIssuedGrant } from '@/lib/chatgpt/grant'
import { validateOrigin, requireIdentity } from '@/lib/platform/server'
import { readBoundedJson } from '@/lib/http'
import { AiHttpError } from '@/lib/ai/server'
import { z } from 'zod/v3'
import { chatgptEnabled, dcrEnabled, allowedOAuthClientId, allowedClientCallback, mcpResource } from '@/lib/chatgpt/config'
import { validateRegistration } from '@/lib/chatgpt/registration'
import { normalizeAuthorization, validateSignedQuery } from '@/lib/chatgpt/query'
import { privateHeaders, rateLimit } from '@/lib/chatgpt/auth'
import { admitIntegrationRequest } from '@/lib/chatgpt/admission'
import { oauthRateOwner } from '@/lib/chatgpt/rate-owner'
import { requireRefreshConnection } from '@/lib/chatgpt/lifecycle'
import { ConnectionError, diagnoseConnection, type ConnectionRoute } from '@/lib/chatgpt/diagnostics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const formKeys = new Set(['grant_type','client_id','code','code_verifier','redirect_uri','resource','refresh_token','scope','token','token_type_hint'])
async function form(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded') throw new AiHttpError(415, 'Expected form data')
  // Reuse the streaming byte cap before parsing a form, including chunked input.
  const reader = request.body?.getReader()
  if (!reader) throw new AiHttpError(400, 'Invalid request')
  let size = 0, text = ''
  const decoder = new TextDecoder('utf-8', { fatal: true })
  try { while (true) {
    const chunk = await reader.read(); if (chunk.done) break
    size += chunk.value.byteLength
    if (size > 8192) { await reader.cancel(); throw new AiHttpError(413, 'Request too large') }
    text += decoder.decode(chunk.value, { stream: true })
  }; text += decoder.decode() } finally { reader.releaseLock() }
  const values = new URLSearchParams(text)
  for (const key of values.keys()) if (!formKeys.has(key) || values.getAll(key).length !== 1) throw new AiHttpError(400, 'Invalid request')
  if (!allowedOAuthClientId(values.get('client_id') ?? '')) throw new AiHttpError(400, 'Invalid client')
  if (values.has('redirect_uri') && !allowedClientCallback(values.get('client_id')!, values.get('redirect_uri')!)) throw new AiHttpError(400, 'Invalid callback')
  if (values.has('resource') && values.get('resource') !== mcpResource()) throw new AiHttpError(400, 'Invalid resource')
  return values.toString()
}
async function handle(request: Request, context: { params: Promise<{ action: string }> }) {
  if (!chatgptEnabled()) return Response.json({ error: 'Not found' }, { status: 404, headers: privateHeaders })
  let diagnosticRoute: ConnectionRoute = 'oauth:unknown'
  try {
    const { action } = await context.params
    if (['register', 'authorize', 'consent', 'token', 'revoke'].includes(action)) diagnosticRoute = `oauth:${action}` as ConnectionRoute
    let body: string | undefined
    const url = new URL(request.url)
    if (action === 'register' && request.method === 'POST' && dcrEnabled()) {
      if (request.headers.has('cookie') || request.headers.has('authorization')) throw new AiHttpError(400, 'Credentials are not supported here')
      const origin = request.headers.get('origin')
      if (origin && origin !== 'https://chatgpt.com') throw new AiHttpError(403, 'Request not allowed')
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new AiHttpError(415, 'Expected JSON')
      // A fixed service bucket bounds anonymous client creation without creating
      // attacker-chosen durable keys or spending any signed-in user's quota.
      await rateLimit('oauth:register', 10)
      body = JSON.stringify(validateRegistration(await readBoundedJson(request, 4096)))
    } else if (action === 'authorize' && request.method === 'GET') {
      url.search = normalizeAuthorization(url.searchParams).toString()
    } else if (action === 'consent' && request.method === 'POST') {
      validateOrigin(request.headers, true)
      const identity = await requireIdentity(request.headers)
      await rateLimit(`oauth:consent:user:${identity.id}`, 120)
      const value = z.object({ accept: z.boolean(), oauth_query: z.string().max(4096) }).strict().parse(await readBoundedJson(request, 8192))
      await validateSignedQuery(value.oauth_query)
      body = JSON.stringify(value)
    } else if (['token','revoke'].includes(action) && request.method === 'POST') {
      if (request.headers.has('cookie')) throw new AiHttpError(400, 'Cookies are not supported here')
      const origin = request.headers.get('origin')
      if (origin && origin !== 'https://chatgpt.com') throw new AiHttpError(403, 'Request not allowed')
      body = await form(request)
    } else return Response.json({ error: 'Not found' }, { status: 404, headers: privateHeaders })
    if (action !== 'authorize' && url.search) throw new AiHttpError(400, 'Invalid request')
    const response = await admitIntegrationRequest(`oauth:${action}:${body ?? url.search}`, async () => {
      if (action === 'authorize') {
        // Anonymous authorization starts remain supported, without shared debt.
        try {
          const identity = await requireIdentity(request.headers, true)
          await rateLimit(`oauth:authorize:user:${identity.id}`, 120)
        } catch (error) { if (!(error instanceof AiHttpError && error.status === 401)) throw error }
      } else if (action === 'token' || action === 'revoke') {
        const owner = await oauthRateOwner(action, new URLSearchParams(body))
        if (owner) await rateLimit(`oauth:${action}:user:${owner}`, 120)
        if (action === 'token') await requireRefreshConnection(new URLSearchParams(body))
      }
      // Quotas run before the provider consumes a code or rotates a refresh.
      return getAuth().handler(new Request(url, { method: request.method, headers: request.headers, body }))
    })
    const headers = new Headers(response.headers)
    for (const [key, value] of Object.entries(privateHeaders)) headers.set(key, value)
    if (response.status >= 400) {
      let code = 'invalid_request'
      try { const failure = await response.json(); if (['invalid_request','invalid_client','invalid_grant','unauthorized_client','unsupported_grant_type','invalid_scope','access_denied','temporarily_unavailable'].includes(failure.error)) code = failure.error } catch { /* Keep the bounded public fallback. */ }
      return diagnoseConnection(Response.json({ error: code, error_description: 'Connection could not be completed. Start again in ChatGPT or Codex.' }, { status: response.status, headers }), diagnosticRoute, undefined, code)
    }
    if (['authorize','consent'].includes(action)) await recordIssuedGrant(request,response)
    return diagnoseConnection(new Response(response.body, { status: response.status, headers }), diagnosticRoute)
  } catch (error) {
    const inactiveConnection = error instanceof ConnectionError
    return diagnoseConnection(Response.json({ error: inactiveConnection ? 'invalid_grant' : 'invalid_request',
      error_description: inactiveConnection ? 'This connection has ended. Reconnect Amountly in ChatGPT or Codex.' : 'Connection request could not be completed. Start again in ChatGPT or Codex.' },
      { status: error instanceof AiHttpError ? error.status : error instanceof z.ZodError ? 400 : 503,
        headers: error instanceof AiHttpError && error.status === 429 ? { ...privateHeaders, 'Retry-After': '60' } : privateHeaders }), diagnosticRoute, error)
  }
}
export const GET = handle
export const POST = handle
