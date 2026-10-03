export const dynamic = 'force-dynamic'
import { mcpAuthError, privateHeaders, requireMcpIdentity } from '@/lib/chatgpt/auth'
import { AiHttpError } from '@/lib/ai/server'
export async function GET(request: Request) {
  try {
    const identity = await requireMcpIdentity(request)
    if (!identity.scopes.includes('email')) throw new AiHttpError(403, 'Email permission is required')
    return Response.json({ sub: identity.id, email: identity.email, email_verified: true }, { headers: privateHeaders })
  } catch (error) { return mcpAuthError(error) }
}
