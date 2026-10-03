import { createHash } from 'node:crypto'
import { z } from 'zod/v3'
import { authPool, getAuth } from '@/lib/platform/auth'
import { clientForIdentity } from '@/lib/platform/server'
import { AiHttpError } from '@/lib/ai/server'
import { allowedClientDocument, chatgptEnabled, mcpResource, oauthIssuer, readScope } from '@/lib/chatgpt/config'
import type { ReviewClient } from '@/lib/financial-review/service'

export const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }

// Shared database counters are atomic across processes, with a fixed bounded
// key space. Caller-controlled IP/forwarded headers never select a rate key.
export async function rateLimit(key: string, max: number) {
  const result = await authPool().query(`insert into amountly_auth.mcp_rate (key, window_start, count)
    values ($1, date_trunc('minute', now()), 1)
    on conflict (key) do update set window_start = excluded.window_start,
      count = case when mcp_rate.window_start = excluded.window_start then mcp_rate.count + 1 else 1 end
    returning count`, [key])
  if (Number(result.rows[0]?.count) > max) throw new AiHttpError(429, 'Too many requests. Try again shortly.')
}

const claimsSchema = z.object({ active: z.literal(true), iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]), sub: z.string().uuid(),
  client_id: z.string(), exp: z.number(), scope: z.string(), token_type: z.literal('Bearer'),
  sid: z.string().min(1), cnf: z.unknown().optional() })

export function validateClaims(input: unknown, clientId: string, now = Date.now() / 1000) {
  const claims = claimsSchema.safeParse(input)
  if (!claims.success || claims.data.iss !== oauthIssuer() || claims.data.client_id !== clientId
    || claims.data.exp <= now || claims.data.cnf !== undefined
    || !(Array.isArray(claims.data.aud) ? claims.data.aud : [claims.data.aud]).includes(mcpResource())) {
    throw new AiHttpError(401, 'Reconnect Amountly to continue.')
  }
  if (!claims.data.scope.split(' ').includes(readScope)) throw new AiHttpError(403, 'Read permission is required.')
  return claims.data
}

export async function requireMcpIdentity(request: Request) {
  if (!chatgptEnabled()) throw new AiHttpError(404, 'Not found')
  const authorization = request.headers.get('authorization') ?? ''
  if (!/^Bearer amt_at_[A-Za-z0-9_-]{20,200}$/.test(authorization)) throw new AiHttpError(401, 'Connect Amountly to continue.')
  await rateLimit('mcp:authentication', 240)
  const token = authorization.slice(7)
  const lookup = await authPool().query(`select a."clientId" from amountly_auth."oauthAccessToken" a
    join amountly_auth.mcp_grants g on g.authorization_code_id=a."authorizationCodeId" and g.user_id=a."userId"
    where a.token=$1 and g.revoked_at is null and g.granted_at > now()-interval '7 days'`,
    [createHash('sha256').update(token.slice('amt_at_'.length)).digest('hex')])
  const clientId: unknown = lookup.rows[0]?.clientId
  if (typeof clientId !== 'string' || !allowedClientDocument(clientId)) throw new AiHttpError(401, 'Reconnect Amountly to continue.')
  let introspected: unknown
  try { introspected = await getAuth().api.validateAmountlyToken({ body: { token, clientId } }) }
  catch { throw new AiHttpError(401, 'Reconnect Amountly to continue.') }
  const claims = validateClaims(introspected, clientId)
  // Recheck the underlying login session, email verification and active account
  // at the database boundary on every request. Revocation is immediate.
  const result = await authPool().query(`select u.id, u.email, u."emailVerified", u.disabled, u."bannedUntil", p.is_active
    from amountly_auth."user" u join amountly_auth.session s on s."userId"=u.id
    join public.users p on p.id=u.id::uuid
    where u.id=$1 and s.id=$2 and s."expiresAt">now()`, [claims.sub, claims.sid])
  const row = result.rows[0]
  if (!row || !row.emailVerified || row.disabled || row.is_active !== true
    || (row.bannedUntil && new Date(row.bannedUntil) > new Date())) throw new AiHttpError(401, 'Reconnect Amountly to continue.')
  await rateLimit(`mcp:user:${claims.sub}`, 30)
  return { id: claims.sub, email: z.string().email().max(254).parse(row.email), clientId, scopes: claims.scope.split(' ') }
}

export async function mcpClient(request: Request) {
  // postgrest-js is also nested inside the legacy Supabase SDK; its private
  // class fields differ by package identity, while this read-only contract is
  // identical. Do not expose the larger Supabase auth/admin surface.
  return await clientForIdentity(await requireMcpIdentity(request)) as unknown as ReviewClient
}

export function mcpAuthError(error: unknown) {
  const status = error instanceof AiHttpError ? error.status : error instanceof z.ZodError ? 400 : 503
  const headers = new Headers(privateHeaders)
  if (status === 401 || status === 403) headers.set('WWW-Authenticate', `Bearer resource_metadata="${mcpResource().replace('/mcp', '/.well-known/oauth-protected-resource')}", scope="${readScope}", error="${status === 401 ? 'invalid_token' : 'insufficient_scope'}"`)
  if (status === 429) headers.set('Retry-After', '60')
  return Response.json({ error: status === 503 ? 'Amountly is temporarily unavailable.' : error instanceof AiHttpError ? error.message : 'Request failed.' }, { status, headers })
}
