import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import { getAuth } from '@/lib/platform/auth'
import { AiHttpError } from '@/lib/ai/server'
import { AuthorizationRequestError } from '@/lib/chatgpt/diagnostics'
import { allowedClientCallback, allowedOAuthClientId, mcpResource, oauthScopes, readScope } from '@/lib/chatgpt/config'

const authorizeKeys = new Set(['client_id','redirect_uri','response_type','scope','state','code_challenge','code_challenge_method','resource','prompt','login_hint'])

export function validateAuthorization(query: URLSearchParams) {
  if (query.toString().length > 4096) throw new AuthorizationRequestError('authorize_query_too_large')
  for (const key of query.keys()) if (query.getAll(key).length !== 1) throw new AuthorizationRequestError('authorize_duplicate_parameter')
  const clientId = query.get('client_id') ?? '', callback = query.get('redirect_uri') ?? ''
  if (!clientId) throw new AuthorizationRequestError('authorize_client_missing')
  if (!allowedOAuthClientId(clientId)) throw new AuthorizationRequestError('authorize_client_invalid')
  if (!callback) throw new AuthorizationRequestError('authorize_callback_missing')
  if (!allowedClientCallback(clientId, callback)) throw new AuthorizationRequestError('authorize_callback_disallowed')
  if (query.get('response_type') !== 'code') throw new AuthorizationRequestError('authorize_response_type_invalid')
  if (!query.get('resource')) throw new AuthorizationRequestError('authorize_resource_missing')
  if (query.get('resource') !== mcpResource()) throw new AuthorizationRequestError('authorize_resource_mismatch')
  if (query.get('code_challenge_method') !== 'S256') throw new AuthorizationRequestError('authorize_pkce_method_invalid')
  if (!/^[A-Za-z0-9_-]{43}$/.test(query.get('code_challenge') ?? '')) throw new AuthorizationRequestError('authorize_pkce_challenge_invalid')
  if (!(query.get('state') ?? '').length || (query.get('state') ?? '').length > 2048) throw new AuthorizationRequestError('authorize_state_invalid')
  const scopes = (query.get('scope') ?? '').split(' ')
  if (!scopes.includes(readScope) || scopes.some(scope => !(oauthScopes as readonly string[]).includes(scope))) throw new AuthorizationRequestError('authorize_scope_invalid')
}

export function normalizeAuthorization(query: URLSearchParams) {
  // RFC 6749 section 3.1: ignore unknown extensions. Bound and validate the
  // original input first, then strip extensions so they cannot configure the
  // provider or inject its internal signed-query fields.
  validateAuthorization(query)
  const normalized = new URLSearchParams()
  for (const [key, value] of query) if (authorizeKeys.has(key) && value !== '') normalized.append(key, value)
  return normalized
}

export async function validateSignedQuery(query: string) {
  if (query.length > 4096 || !await verifyOAuthQueryParams(query, (await getAuth().$context).secret)) throw new AuthorizationRequestError('authorize_signature_invalid')
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
