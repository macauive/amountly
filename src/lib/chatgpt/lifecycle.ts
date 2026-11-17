import { createHash } from 'node:crypto'
import { authPool } from '@/lib/platform/auth'
import { ConnectionError } from '@/lib/chatgpt/diagnostics'

// Reject terminally inactive connections before the provider rotates a usable
// refresh token. Unknown, expired and replayed tokens still reach the provider,
// preserving its validation and replay-family revocation behavior.
export async function requireRefreshConnection(values: URLSearchParams) {
  if (values.get('grant_type') !== 'refresh_token') return
  const token = values.get('refresh_token') ?? ''
  if (!/^amt_rt_[A-Za-z0-9_-]{20,200}$/.test(token)) return
  const digest = createHash('sha256').update(token.slice(7)).digest('hex')
  const result = await authPool().query(`select
    (g.revoked_at is null and g.granted_at > now()-interval '7 days') as "grantActive",
    (s."expiresAt">now()) as "sessionActive",
    (u."emailVerified"=true and u.disabled=false and (u."bannedUntil" is null or u."bannedUntil"<=now())
      and p.is_active=true) as "accountActive"
    from amountly_auth."oauthRefreshToken" t
    left join amountly_auth.mcp_grants g on g.authorization_code_id=t."authorizationCodeId" and g.user_id=t."userId"
    left join amountly_auth.session s on s.id=t."sessionId" and s."userId"=t."userId"
    left join amountly_auth."user" u on u.id=t."userId"
    left join public.users p on p.id=u.id::uuid
    where t.token=$1 and t."clientId"=$2 and t.revoked is null and t."expiresAt">now()`, [digest, values.get('client_id')])
  const row = result.rows[0]
  if (!row) return
  if (row.grantActive !== true) throw new ConnectionError(400, 'grant_inactive')
  if (row.accountActive !== true) throw new ConnectionError(400, 'account_inactive')
  if (row.sessionActive !== true) throw new ConnectionError(400, 'session_inactive')
}
