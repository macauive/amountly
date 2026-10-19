export const dynamic = 'force-dynamic'
import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider'
import { getAuth } from '@/lib/platform/auth'
import { chatgptEnabled } from '@/lib/chatgpt/config'
import { privateHeaders } from '@/lib/chatgpt/auth'
import { appOrigin } from '@/lib/platform/config'
export async function GET(request: Request) {
  if (!chatgptEnabled()) return new Response(null, { status: 404 })
  const response = await oauthProviderAuthServerMetadata(getAuth(), { headers: privateHeaders })(request)
  if (!response.ok) return response
  const metadata = await response.json()
  // Introspection is an internal protected-resource capability, not a public
  // endpoint. Advertise only the authentication methods enabled for ChatGPT.
  delete metadata.introspection_endpoint
  delete metadata.introspection_endpoint_auth_methods_supported
  delete metadata.introspection_endpoint_auth_signing_alg_values_supported
  delete metadata.client_id_metadata_document_supported
  delete metadata.token_endpoint_auth_signing_alg_values_supported
  delete metadata.revocation_endpoint_auth_signing_alg_values_supported
  const methods = ['none']
  return Response.json({ ...metadata, token_endpoint_auth_methods_supported: methods,
    revocation_endpoint_auth_methods_supported: methods, userinfo_endpoint: `${appOrigin()}/oauth/userinfo` }, { headers: privateHeaders })
}
