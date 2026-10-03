import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import { getAuth } from '@/lib/platform/auth'
import { AiHttpError } from '@/lib/ai/server'
import { allowedCallback, allowedClientDocument, mcpResource, oauthScopes, readScope } from '@/lib/chatgpt/config'

export function validateAuthorization(query: URLSearchParams) {
  if (query.toString().length > 4096) throw new AiHttpError(400, 'Invalid connection request')
  for (const key of query.keys()) if (query.getAll(key).length !== 1) throw new AiHttpError(400, 'Invalid connection request')
  if (!allowedClientDocument(query.get('client_id') ?? '') || !allowedCallback(query.get('redirect_uri') ?? '')
    || query.get('response_type') !== 'code' || query.get('resource') !== mcpResource()
    || query.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(query.get('code_challenge') ?? '')
    || !(query.get('state') ?? '').length || (query.get('state') ?? '').length > 2048) throw new AiHttpError(400, 'Invalid connection request')
  const scopes = (query.get('scope') ?? '').split(' ')
  if (!scopes.includes(readScope) || scopes.some(scope => !(oauthScopes as readonly string[]).includes(scope))) throw new AiHttpError(400, 'Invalid permission request')
}

export async function validateSignedQuery(query: string) {
  if (query.length > 4096 || !await verifyOAuthQueryParams(query, (await getAuth().$context).secret)) throw new AiHttpError(400, 'Connection request expired. Start again in ChatGPT.')
  const parameters = new URLSearchParams(query)
  // The provider signs a repeated ba_param list naming its protected fields.
  // Verify that signature first; authorization parameters remain single-valued.
  parameters.delete('ba_param')
  validateAuthorization(parameters)
  return query
}

export function signedSearchParams(params: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') query.append(key,value)
    else if (key === 'ba_param' && Array.isArray(value) && value.length <= 30) value.forEach(item => query.append(key,item))
    else throw new AiHttpError(400, 'Invalid connection request')
  }
  return query.toString()
}
