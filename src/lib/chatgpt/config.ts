import { appOrigin } from '@/lib/platform/config'
import { isDcrClientId } from '@/lib/chatgpt/redirect'

export const readScope = 'amountly:read'
export const connectionScopes = [readScope, 'offline_access'] as const
export const oauthScopes = [...connectionScopes, 'email'] as const
export const mcpResource = () => `${appOrigin()}/mcp`
export const oauthIssuer = () => `${appOrigin()}/api/auth`
export const chatgptEnabled = () => process.env.NEXT_PUBLIC_BACKEND === 'render' && process.env.AMOUNTLY_CHATGPT === 'enabled'
export const dcrEnabled = () => chatgptEnabled() && process.env.AMOUNTLY_CHATGPT_DCR === 'enabled'

export const allowedOAuthClientId = (value: string) => dcrEnabled() && isDcrClientId(value)

export { allowedCallback, allowedClientCallback } from '@/lib/chatgpt/redirect'
