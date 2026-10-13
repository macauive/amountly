import { createHash } from 'node:crypto'
import { z } from 'zod/v3'
import { stripAccessTokenAuthorizationScheme } from 'better-auth/oauth2'
import { authPool } from '@/lib/platform/auth'
import { mcpResource } from '@/lib/chatgpt/config'

const codeValue = z.object({ type: z.literal('authorization_code'), userId: z.string().uuid(), sessionId: z.string().uuid(),
  resource: z.array(z.string()).optional(), query: z.object({ client_id: z.string(), redirect_uri: z.string(),
    resource: z.union([z.string(), z.array(z.string())]).optional(),
    code_challenge_method: z.literal('S256'), code_challenge: z.string(),
  }) })

// This is admission attribution only. The provider still authenticates the
// client, PKCE, resource, expiry and replay state before issuing/revoking tokens.
// A publicly known client_id or a guessed code must never debit another owner.
export async function oauthRateOwner(action: 'token' | 'revoke', values: URLSearchParams): Promise<string | null> {
  const client = values.get('client_id')!, grant = values.get('grant_type')
  let owner: unknown, session: unknown
  if (action === 'token' && grant === 'authorization_code') {
    const code = values.get('code') ?? '', verifier = values.get('code_verifier') ?? ''
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(code) || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return null
    const digest = createHash('sha256').update(code).digest('hex')
    const result = await authPool().query(`select v.value, g.user_id from amountly_auth.verification v
      join amountly_auth.mcp_grants g on g.authorization_code_id=v.identifier
      where v.identifier=$1 and v."expiresAt">now() and g.revoked_at is null and g.granted_at>now()-interval '7 days'`, [digest])
    const row = result.rows[0]
    if (!row) return null
    let parsed
    try { parsed = codeValue.safeParse(JSON.parse(row.value)) } catch { return null }
    if (!parsed.success) return null
    const value = parsed.data, resources = value.resource ?? value.query.resource
    if (value.userId !== row.user_id || value.query.client_id !== client
      || value.query.redirect_uri !== values.get('redirect_uri')
      || ![resources].flat().includes(mcpResource())
      || (values.has('resource') && values.get('resource') !== mcpResource())
      || createHash('sha256').update(verifier).digest('base64url') !== value.query.code_challenge) return null
    owner = value.userId; session = value.sessionId
  } else {
    const raw = values.get(action === 'revoke' ? 'token' : 'refresh_token') ?? ''
    const token = action === 'revoke' ? stripAccessTokenAuthorizationScheme(raw) : raw
    const refresh = /^amt_rt_[A-Za-z0-9_-]{20,200}$/.test(token)
    if ((!refresh && !/^amt_at_[A-Za-z0-9_-]{20,200}$/.test(token))
      || (action === 'token' && (grant !== 'refresh_token' || !refresh))) return null
    const digest = createHash('sha256').update(token.slice(7)).digest('hex')
    // The selected table comes from the checked prefix, never request text.
    const table = refresh ? 'oauthRefreshToken' : 'oauthAccessToken'
    const result = await authPool().query(`select t."userId",t."sessionId" from amountly_auth."${table}" t
      where t.token=$1 and t."clientId"=$2 and t."expiresAt">now() and t.revoked is null`, [digest, client])
    // Grant/session expiry governs MCP access, not attribution of a still-valid
    // provider capability. Its stored, client-bound secret proves ownership even
    // after that login ends. This does not grant access or skip provider checks.
    owner = result.rows[0]?.userId
    return z.string().uuid().safeParse(owner).success ? owner as string : null
  }
  if (!z.string().uuid().safeParse(owner).success || !z.string().uuid().safeParse(session).success) return null
  const result = await authPool().query(`select u.id from amountly_auth."user" u
    join amountly_auth.session s on s."userId"=u.id join public.users p on p.id=u.id::uuid
    where u.id=$1 and s.id=$2 and s."expiresAt">now() and u."emailVerified"=true
    and u.disabled=false and (u."bannedUntil" is null or u."bannedUntil"<=now()) and p.is_active=true`, [owner, session])
  return result.rows[0]?.id === owner ? owner as string : null
}
