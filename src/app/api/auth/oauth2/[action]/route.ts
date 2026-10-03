import { getAuth } from '@/lib/platform/auth'
import { recordIssuedGrant } from '@/lib/chatgpt/grant'
import { validateOrigin, requireIdentity } from '@/lib/platform/server'
import { readBoundedJson } from '@/lib/http'
import { AiHttpError } from '@/lib/ai/server'
import { z } from 'zod/v3'
import { chatgptEnabled, allowedClientDocument, allowedCallback, mcpResource } from '@/lib/chatgpt/config'
import { validateAuthorization, validateSignedQuery } from '@/lib/chatgpt/query'
import { privateHeaders, rateLimit } from '@/lib/chatgpt/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const authorizeKeys = new Set(['client_id','redirect_uri','response_type','scope','state','code_challenge','code_challenge_method','resource','prompt','login_hint'])
const formKeys = new Set(['grant_type','client_id','client_assertion','client_assertion_type','code','code_verifier','redirect_uri','resource','refresh_token','scope','token','token_type_hint'])
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
  if (!allowedClientDocument(values.get('client_id') ?? '')) throw new AiHttpError(400, 'Invalid client')
  if (values.has('redirect_uri') && !allowedCallback(values.get('redirect_uri')!)) throw new AiHttpError(400, 'Invalid callback')
  if (values.has('resource') && values.get('resource') !== mcpResource()) throw new AiHttpError(400, 'Invalid resource')
  return values.toString()
}
async function handle(request: Request, context: { params: Promise<{ action: string }> }) {
  if (!chatgptEnabled()) return Response.json({ error: 'Not found' }, { status: 404, headers: privateHeaders })
  try {
    const { action } = await context.params
    let body: string | undefined
    const url = new URL(request.url)
    if (action === 'authorize' && request.method === 'GET') {
      for (const key of url.searchParams.keys()) if (!authorizeKeys.has(key)) throw new AiHttpError(400, 'Invalid authorization request')
      validateAuthorization(url.searchParams)
      await rateLimit('oauth:authorize', 120)
    } else if (action === 'consent' && request.method === 'POST') {
      validateOrigin(request.headers, true)
      await requireIdentity(request.headers)
      const value = z.object({ accept: z.boolean(), oauth_query: z.string().max(4096) }).strict().parse(await readBoundedJson(request, 8192))
      await validateSignedQuery(value.oauth_query)
      body = JSON.stringify(value)
    } else if (['token','revoke'].includes(action) && request.method === 'POST') {
      if (request.headers.has('cookie')) throw new AiHttpError(400, 'Cookies are not supported here')
      const origin = request.headers.get('origin')
      if (origin && origin !== 'https://chatgpt.com') throw new AiHttpError(403, 'Request not allowed')
      await rateLimit(`oauth:${action}`, 120)
      body = await form(request)
    } else return Response.json({ error: 'Not found' }, { status: 404, headers: privateHeaders })
    if (action !== 'authorize' && url.search) throw new AiHttpError(400, 'Invalid request')
    const response = await getAuth().handler(new Request(request.url, { method: request.method, headers: request.headers, body }))
    const headers = new Headers(response.headers)
    for (const [key, value] of Object.entries(privateHeaders)) headers.set(key, value)
    if (!response.ok) {
      let code = 'invalid_request'
      try { const failure = await response.json(); if (['invalid_request','invalid_client','invalid_grant','unauthorized_client','unsupported_grant_type','invalid_scope','access_denied','temporarily_unavailable'].includes(failure.error)) code = failure.error } catch { /* Keep the bounded public fallback. */ }
      return Response.json({ error: code, error_description: 'Connection could not be completed. Start again in ChatGPT.' }, { status: response.status, headers })
    }
    if (['authorize','consent'].includes(action)) await recordIssuedGrant(request,response)
    return new Response(response.body, { status: response.status, headers })
  } catch (error) {
    return Response.json({ error: 'invalid_request', error_description: 'Connection request could not be completed. Start again in ChatGPT.' },
      { status: error instanceof AiHttpError ? error.status : error instanceof z.ZodError ? 400 : 503, headers: privateHeaders })
  }
}
export const GET = handle
export const POST = handle
