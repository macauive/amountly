import { getAuth } from '@/lib/platform/auth'
import { usesRenderBackend } from '@/lib/platform/config'
import { readBoundedJson } from '@/lib/http'
import { validateOrigin } from '@/lib/platform/server'
import { AiHttpError } from '@/lib/ai/server'
import { z } from 'zod/v3'
import { chatgptEnabled } from '@/lib/chatgpt/config'
import { validateSignedQuery } from '@/lib/chatgpt/query'
import { recordIssuedGrant } from '@/lib/chatgpt/grant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const posts = new Set(['sign-in/email', 'sign-up/email', 'sign-out', 'change-password',
  'email-otp/send-verification-otp', 'email-otp/verify-email', 'email-otp/request-password-reset', 'email-otp/reset-password'])
const email = z.string().trim().email().max(254)
const password = z.string().min(1).max(128)
const otp = z.string().regex(/^\d{6}$/)
const bodies: Record<string, z.ZodTypeAny> = {
  'sign-in/email': z.object({ email, password, oauth_query: z.string().max(4096).optional() }).strict(),
  'sign-up/email': z.object({ email, password: password.min(12), name: z.string().trim().min(2).max(120) }).strict(),
  'sign-out': z.object({}).strict(),
  'change-password': z.object({ currentPassword: password, newPassword: password.min(12), revokeOtherSessions: z.literal(true) }).strict(),
  'email-otp/send-verification-otp': z.object({ email, type: z.literal('email-verification') }).strict(),
  'email-otp/verify-email': z.object({ email, otp }).strict(),
  'email-otp/request-password-reset': z.object({ email }).strict(),
  'email-otp/reset-password': z.object({ email, otp, password: password.min(12) }).strict(),
}
async function handle(request: Request, context: { params: Promise<{ all: string[] }> }) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
  if (!usesRenderBackend) return Response.json({ error: 'Not found' }, { status: 404, headers })
  try {
    const path = (await context.params).all.join('/')
    if (!(request.method === 'GET' ? path === 'get-session' : request.method === 'POST' && posts.has(path))) {
      return Response.json({ error: 'Not found' }, { status: 404, headers })
    }
    validateOrigin(request.headers, request.method === 'POST')
    let body: string | undefined
    if (request.method === 'POST') {
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new AiHttpError(415, 'Expected JSON')
      const parsed = bodies[path].safeParse(await readBoundedJson(request, 16384))
      if (!parsed.success) throw new AiHttpError(400, 'Invalid authentication input')
      if (parsed.data.oauth_query) {
        if (!chatgptEnabled()) throw new AiHttpError(400, 'Invalid authentication input')
        await validateSignedQuery(parsed.data.oauth_query)
      }
      body = JSON.stringify(parsed.data)
    }
    const response = await getAuth().handler(new Request(request.url, { method: request.method, headers: request.headers, body }))
    if (path === 'sign-in/email' && body && JSON.parse(body).oauth_query && response.ok) await recordIssuedGrant(request,response)
    const result = await response.json()
    // Browser authentication is cookie-only; never return a reusable session token.
    if (result && typeof result === 'object') {
      delete result.token
      if (result.session) delete result.session.token
    }
    const safeHeaders = new Headers(headers)
    for (const cookie of response.headers.getSetCookie()) safeHeaders.append('Set-Cookie', cookie)
    if (!response.ok) return Response.json({ error: 'Authentication could not be completed. Check your details and try again.', code: result?.code }, { status: response.status, headers: safeHeaders })
    return Response.json(result, { status: response.status, headers: safeHeaders })
  } catch (error) {
    return Response.json({ error: 'Authentication is temporarily unavailable.' }, { status: error instanceof AiHttpError ? error.status : 503, headers })
  }
}
export const GET = handle
export const POST = handle
