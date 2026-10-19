import { betterAuth } from 'better-auth'
import { emailOTP } from 'better-auth/plugins'
import { hashPassword, verifyPassword } from 'better-auth/crypto'
import { compare } from 'bcryptjs'
import { Pool } from 'pg'
import { sendAuthCode } from '@/lib/platform/auth-email'
import { appOrigin, requiredSecret } from '@/lib/platform/config'
import { oauthProvider, getOAuthProviderApi } from '@better-auth/oauth-provider'
import { createAuthEndpoint } from 'better-auth/api'
import { z } from 'zod'
import { cimd } from '@better-auth/cimd'
import { fetchClientMetadataResource } from '@better-auth/cimd/node'
import { allowedClientDocument, chatgptEnabled } from '@/lib/chatgpt/config'
import { oauthOptions } from '@/lib/chatgpt/oauth'
import { oauthRateRules } from '@/lib/chatgpt/admission'

let instance: ReturnType<typeof buildAuth> | undefined
let pool: Pool | undefined
export function authPool() {
  return pool ??= new Pool({ connectionString: requiredSecret('AUTH_DATABASE_URL'),
    max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
    options: '-c search_path=amountly_auth,pg_catalog -c statement_timeout=10000' })
}

function buildAuth() {
  const secret = requiredSecret('BETTER_AUTH_SECRET')
  if (secret.length < 32) throw new Error('Invalid authentication configuration')
  const provider = chatgptEnabled() ? oauthProvider(oauthOptions()) : null
  return betterAuth({
    appName: 'Amountly', baseURL: appOrigin(), secret, database: authPool(),
    trustedOrigins: [appOrigin()],
    advanced: { database: { generateId: 'uuid' }, cookiePrefix: 'amountly',
      useSecureCookies: appOrigin().startsWith('https:'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' } },
    emailAndPassword: { enabled: true, requireEmailVerification: true,
      minPasswordLength: 12, maxPasswordLength: 128, revokeSessionsOnPasswordReset: true,
      password: { hash: hashPassword, verify: async ({ hash, password }) =>
        /^\$2[aby]\$/.test(hash) ? compare(password, hash) : verifyPassword({ hash, password }) } },
    emailVerification: { autoSignInAfterVerification: true },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, freshAge: 60 * 10,
      cookieCache: { enabled: false } },
    user: { deleteUser: { enabled: false }, changeEmail: { enabled: false },
      additionalFields: { bannedUntil: { type: 'date', required: false, input: false },
        disabled: { type: 'boolean', required: false, defaultValue: false, input: false } } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60,
      customRules: { '/sign-in/email': { window: 60, max: 5 }, '/sign-up/email': { window: 60, max: 3 }, ...oauthRateRules } },
    databaseHooks: { session: { create: { before: async session => {
      const result = await authPool().query('select disabled, "bannedUntil" from amountly_auth."user" where id=$1', [session.userId])
      const user = result.rows[0]
      if (!user || user.disabled || (user.bannedUntil && new Date(user.bannedUntil) > new Date())) return false
      const profile = await authPool().query('select is_active from public.users where id=$1', [session.userId])
      if (profile.rows[0]?.is_active === false) return false
      return { data: session }
    } } } },
    plugins: [emailOTP({ sendVerificationOTP: ({ email, otp, type }) => sendAuthCode(email, otp, type),
      sendVerificationOnSignUp: true, overrideDefaultEmailVerification: true,
      disableSignUp: true, storeOTP: 'hashed', otpLength: 6, expiresIn: 600, allowedAttempts: 3 }),
      ...(provider ? [provider, cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28',
        isMetadataDocumentUrlAllowed: allowedClientDocument, maxCacheEntries: 100,
        metadataRevalidationInterval: '10m',
      }), { id: 'amountly-protected-resource', endpoints: {
        // Server API only. The public catch-all and OAuth router never forward
        // this endpoint. Resource validation does not require the caller to
        // possess ChatGPT's private client signing key.
        validateAmountlyToken: createAuthEndpoint('/internal/amountly-token', {
          method: 'POST', body: z.object({ token: z.string().max(256), clientId: z.string().max(256) }),
        // Use the initialized provider options, including CIMD's discovery
        // extension. Fresh options cannot validate a discovered ChatGPT client.
        }, async ctx => getOAuthProviderApi(ctx, provider.options).requireActiveAccessToken(ctx.body.token, ctx.body.clientId)),
      } }] : [])],
    logger: { disabled: true },
    onAPIError: { onError: () => { console.error('Authentication request failed') } },
  })
}

export function getAuth() { return instance ??= buildAuth() }
