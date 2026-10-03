import { authPool } from '@/lib/platform/auth'
import { requireIdentity, validateOrigin } from '@/lib/platform/server'
import { chatgptEnabled, allowedClientDocument } from '@/lib/chatgpt/config'
import { mcpAuthError, privateHeaders } from '@/lib/chatgpt/auth'
import { readBoundedJson } from '@/lib/http'
import { z } from 'zod/v3'
export async function POST(request: Request) {
  if (!chatgptEnabled()) return new Response(null, { status: 404 })
  let connection
  try {
    validateOrigin(request.headers, true)
    z.object({}).strict().parse(await readBoundedJson(request, 1024))
    const identity = await requireIdentity(request.headers)
    connection = await authPool().connect()
    await connection.query('begin')
    // Each token family remains bound to the original authorization grant.
    // Revoke that grant first so an in-flight refresh cannot restore access.
    await connection.query('update amountly_auth.mcp_grants set revoked_at=now() where user_id=$1 and revoked_at is null', [identity.id])
    const result = await connection.query('select distinct "clientId" from amountly_auth."oauthAccessToken" where "userId"=$1', [identity.id])
    const clients = result.rows.map(row => row.clientId).filter(allowedClientDocument)
    await connection.query('update amountly_auth."oauthAccessToken" set revoked=now() where "userId"=$1 and "clientId"=any($2::text[])', [identity.id, clients])
    await connection.query('update amountly_auth."oauthRefreshToken" set revoked=now() where "userId"=$1 and "clientId"=any($2::text[])', [identity.id, clients])
    await connection.query('delete from amountly_auth."oauthConsent" where "userId"=$1 and "clientId"=any($2::text[])', [identity.id, clients])
    await connection.query('commit')
    return Response.json({ disconnected: true }, { headers: privateHeaders })
  } catch (error) { if (connection) await connection.query('rollback'); return mcpAuthError(error) }
  finally { connection?.release() }
}
