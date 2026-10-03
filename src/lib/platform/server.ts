import { PostgrestClient } from '@supabase/postgrest-js'
import { SignJWT } from 'jose'
import { getAuth, authPool } from '@/lib/platform/auth'
import { appOrigin, requiredSecret } from '@/lib/platform/config'
import { AiHttpError } from '@/lib/ai/server'

export function validateOrigin(headers: Headers, mutating = false) {
  const origin = headers.get('origin')
  if ((origin && origin !== appOrigin()) || headers.get('sec-fetch-site') === 'cross-site'
    || (mutating && !origin && !headers.has('authorization'))) throw new AiHttpError(403, 'Request not allowed')
}

export async function requireIdentity(headers: Headers) {
  validateOrigin(headers)
  // No cookie cache: session revocation and account disablement apply immediately.
  const session = await getAuth().api.getSession({ headers, query: { disableCookieCache: true } })
  if (!session?.user.emailVerified || session.user.disabled
    || (session.user.bannedUntil && new Date(session.user.bannedUntil) > new Date())) throw new AiHttpError(401, 'Sign in to continue')
  const result = await authPool().query('select is_active from public.users where id=$1', [session.user.id])
  if (result.rows[0]?.is_active === false) throw new AiHttpError(403, 'Account unavailable')
  return { id: session.user.id, email: session.user.email }
}

export async function identityToken(identity: { id: string; email: string }) {
  const secret = requiredSecret('POSTGREST_JWT_SECRET')
  if (secret.length < 32) throw new Error('Invalid database configuration')
  return new SignJWT({ role: 'authenticated', email: identity.email })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(identity.id).setIssuedAt().setExpirationTime('60s')
    .sign(new TextEncoder().encode(secret))
}

// Only loopback is used. The private PostgREST process accepts server-signed
// identities and connects as a non-owner role subject to existing RLS.
export const privateDataOrigin = 'http://127.0.0.1:3001'
export async function serverClient(headers: Headers) {
  const identity = await requireIdentity(headers)
  const token = await identityToken(identity)
  const client = new PostgrestClient(privateDataOrigin, {
    headers: { Authorization: `Bearer ${token}` },
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000), cache: 'no-store' }),
  })
  return Object.assign(client, { auth: { getUser: async () => ({ data: { user: identity }, error: null }) } })
}

export function nodeHeaders(source: Record<string, string | string[] | undefined>) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(source)) if (typeof value === 'string') headers.set(name, value)
  return headers
}
