export const dynamic = 'force-dynamic'
import { chatgptEnabled, mcpResource, oauthIssuer, readScope } from '@/lib/chatgpt/config'
import { privateHeaders } from '@/lib/chatgpt/auth'
export function GET() {
  if (!chatgptEnabled()) return new Response(null, { status: 404 })
  return Response.json({ resource: mcpResource(), authorization_servers: [oauthIssuer()], scopes_supported: [readScope],
    bearer_methods_supported: ['header'], resource_name: 'Amountly', resource_documentation: 'https://amountly.app/support' }, { headers: privateHeaders })
}
