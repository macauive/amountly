import { appOrigin } from '@/lib/platform/config'

export const readScope = 'amountly:read'
export const connectionScopes = [readScope, 'offline_access'] as const
export const oauthScopes = [...connectionScopes, 'email'] as const
export const mcpResource = () => `${appOrigin()}/mcp`
export const oauthIssuer = () => `${appOrigin()}/api/auth`
export const chatgptEnabled = () => process.env.NEXT_PUBLIC_BACKEND === 'render' && process.env.AMOUNTLY_CHATGPT === 'enabled'

// CIMD discovery is restricted to OpenAI's published client documents. The
// library additionally pins public DNS addresses and refuses redirects.
export function allowedClientDocument(value: string) {
  try {
    const url = new URL(value)
    return url.origin === 'https://chatgpt.com' && !url.username && !url.password && !url.search && !url.hash
      && /^\/oauth\/(?:client\.json|[A-Za-z0-9_-]{1,128}\/client\.json)$/.test(url.pathname)
  } catch { return false }
}

export function allowedCallback(value: string) {
  try {
    const url = new URL(value)
    return url.origin === 'https://chatgpt.com' && !url.username && !url.password && !url.search && !url.hash
      && (url.pathname === '/connector_platform_oauth_redirect' || /^\/connector_platform_oauth_redirect\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname))
  } catch { return false }
}
