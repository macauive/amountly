import { authPool, getAuth } from '@/lib/platform/auth'
import { usesRenderBackend } from '@/lib/platform/config'
import { readBoundedJson } from '@/lib/http'
import { validateOrigin } from '@/lib/platform/server'
import { AiHttpError } from '@/lib/ai/server'
import { z } from 'zod/v3'
import { chatgptEnabled } from '@/lib/chatgpt/config'
import { validateSignedQuery } from '@/lib/chatgpt/query'
import { recordIssuedGrant } from '@/lib/chatgpt/grant'
import { clearSignupProof, signupProofCookie, signupProofUser } from '@/lib/platform/signup-proof'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const posts = new Set(['sign-in/email', 'sign-up/email', 'sign-out', 'change-password',
  'email-otp/send-verification-otp', 'email-otp/verify-email', 'email-otp/request-password-reset', 'email-otp/reset-password'])
const email = z.string().trim().email().max(254).toLowerCase()
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
  const invalidOtp = () => Response.json({ code: 'INVALID_OTP',
    error: 'This code could not be verified. Check the code or reset your password.' }, { status: 400, headers })
  let path = ''
  let signupEmail: string | undefined
  try {
    path = (await context.params).all.join('/')
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
      if (path === 'sign-up/email') signupEmail = parsed.data.email
      if (path === 'email-otp/verify-email' || path === 'email-otp/send-verification-otp') {
        const pendingUser = await signupProofUser(request.headers, parsed.data.email)
        if (!pendingUser) return invalidOtp()
        if (path === 'email-otp/send-verification-otp') {
          const pending = await authPool().query(
            'select 1 from amountly_auth."user" where id = $1 and email = $2 and not "emailVerified"',
            [pendingUser, parsed.data.email],
          )
          if (!pending.rowCount) return invalidOtp()
        }
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
    if (signupEmail && (result?.code === 'ACCOUNT_EXISTS' ||
      (result?.code === 'FAILED_TO_CREATE_USER' && (await authPool().query(
        'select 1 from amountly_auth."user" where email = $1', [signupEmail],
      )).rowCount))) {
      return Response.json({ code: 'ACCOUNT_EXISTS',
        error: 'An account already exists for this email. Sign in or reset your password.' }, { status: 409, headers })
    }
    if (!response.ok && path === 'email-otp/verify-email' && response.status !== 429) return invalidOtp()
    const safeHeaders = new Headers(headers)
    if (response.ok && signupEmail) {
      const created = await authPool().query<{ id: string }>(
        'select id from amountly_auth."user" where email = $1 and not "emailVerified"', [signupEmail],
      )
      if (!created.rows[0] || created.rows[0].id !== result?.user?.id) {
        throw new Error('Signup did not create the expected account')
      }
      safeHeaders.append('Set-Cookie', await signupProofCookie(created.rows[0].id, signupEmail))
    }
    if (response.ok && path === 'email-otp/verify-email') safeHeaders.append('Set-Cookie', clearSignupProof())
    for (const cookie of response.headers.getSetCookie()) safeHeaders.append('Set-Cookie', cookie)
    if (!response.ok) return Response.json({ error: 'Authentication could not be completed. Check your details and try again.', code: result?.code }, { status: response.status, headers: safeHeaders })
    return Response.json(result, { status: response.status, headers: safeHeaders })
  } catch (error) {
    if (path === 'email-otp/verify-email' && !(error instanceof AiHttpError)) {
      console.error('Email verification request failed')
      return invalidOtp()
    }
    return Response.json({ error: 'Authentication is temporarily unavailable.' }, { status: error instanceof AiHttpError ? error.status : 503, headers })
  }
}
export const GET = handle
export const POST = handle
