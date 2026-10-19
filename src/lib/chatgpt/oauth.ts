import { createHash, randomBytes } from 'node:crypto'
import type { OAuthOptions } from '@better-auth/oauth-provider'
import { allowedCallback, dcrEnabled, mcpResource, oauthScopes } from '@/lib/chatgpt/config'
export function oauthOptions(): OAuthOptions<string[]> {
  return {
    loginPage: '/chatgpt/login', consentPage: '/chatgpt/consent',
    scopes: [...oauthScopes], grantTypes: ['authorization_code', 'refresh_token'],
    disableJwtPlugin: true, allowDynamicClientRegistration: dcrEnabled(),
    allowUnauthenticatedClientRegistration: dcrEnabled(), clientRegistrationRequirePKCE: true,
    clientRegistrationDefaultScopes: [...oauthScopes],
    generateClientId: () => 'amt_dcr_' + randomBytes(32).toString('base64url'),
    clientPrivileges: () => false, resourcePrivileges: () => false,
    resources: [{ identifier: mcpResource(), name: 'Amountly financial records', allowedScopes: [...oauthScopes], accessTokenTtl: 600 }],
    enforcePerClientResources: true, clientRegistrationDefaultResources: [mcpResource()],
    accessTokenExpiresIn: 600, refreshTokenExpiresIn: 604800, refreshTokenReuseInterval: 0,
    storeTokens: { hash: token => createHash('sha256').update(token).digest('hex') },
    validateRedirectUri: (uri, _registered, exactMatch) => exactMatch && allowedCallback(uri),
    prefix: { opaqueAccessToken: 'amt_at_', refreshToken: 'amt_rt_' },
  }
}
