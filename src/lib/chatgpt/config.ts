import { appOrigin } from '@/lib/platform/config'

export const readScope = 'amountly:read'
export const connectionScopes = [readScope, 'offline_access'] as const
export const oauthScopes = [...connectionScopes, 'email'] as const
export const mcpResource = () => `${appOrigin()}/mcp`
export const oauthIssuer = () => `${appOrigin()}/api/auth`
export const chatgptEnabled = () => process.env.NEXT_PUBLIC_BACKEND === 'render' && process.env.AMOUNTLY_CHATGPT === 'enabled'

// CIMD additionally pins public DNS addresses and refuses metadata redirects.
export { allowedClientDocument, allowedCallback, allowedClientCallback } from '@/lib/chatgpt/redirect'
