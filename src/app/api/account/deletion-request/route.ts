import { authPool } from '@/lib/platform/auth'
import { requireIdentity, validateOrigin } from '@/lib/platform/server'
import { readBoundedJson } from '@/lib/http'
import { mcpAuthError, privateHeaders } from '@/lib/chatgpt/auth'
import { z } from 'zod/v3'
export async function POST(request: Request) {
  try {
    validateOrigin(request.headers, true)
    z.object({}).strict().parse(await readBoundedJson(request, 1024))
    const identity = await requireIdentity(request.headers)
    await authPool().query("insert into amountly_auth.deletion_requests(user_id) values($1) on conflict(user_id) do update set requested_at=now(),status='pending'", [identity.id])
    return Response.json({ requested: true }, { headers: privateHeaders })
  } catch (error) { return mcpAuthError(error) }
}
