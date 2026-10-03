import { PostgrestClient } from '@supabase/postgrest-js'
import type { Session, SupabaseClient, User } from '@supabase/supabase-js'

// Compatibility at the service boundary keeps existing typed PostgREST queries.
// Render sessions use HttpOnly cookies; the access_token field is never populated.
type Listener = (event: string, session: Session | null) => void
const listeners = new Set<Listener>()
async function authCall(path: string, body?: object) {
  try {
    const response = await fetch(`/api/auth/${path}`, { method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store' })
    const data = await response.json()
    return response.ok ? { data, error: null } : { data: null, error: { message: data.error || 'Authentication failed.' } }
  } catch { return { data: null, error: { message: 'Could not reach Amountly. Try again.' } } }
}
function sessionFrom(data: { user?: { id: string; email: string; name: string; createdAt: string; emailVerified: boolean } } | null): Session | null {
  if (!data?.user) return null
  const user: User = { id: data.user.id, email: data.user.email, aud: 'authenticated',
    created_at: data.user.createdAt, app_metadata: {}, user_metadata: { name: data.user.name } }
  return { user, access_token: '', refresh_token: '', token_type: 'bearer', expires_in: 0 }
}
async function getSession() {
  const result = await authCall('get-session')
  return { data: { session: sessionFrom(result.data) }, error: result.error }
}
async function notify(event: string) {
  const { data } = await getSession()
  listeners.forEach(listener => listener(event, data.session))
  return data
}

export function createRenderBrowserClient(): SupabaseClient {
  // Relative URLs cannot be constructed by PostgrestClient during SSR. The
  // custom fetch strips this inert base and always sends to our own API.
  const rest = new PostgrestClient('https://amountly.invalid/api/data', {
    fetch: (input, init) => {
      const url = new URL(String(input))
      return fetch(url.pathname + url.search, { ...init, credentials: 'same-origin', cache: 'no-store' })
    },
  })
  const auth = {
    getSession,
    getUser: async () => { const result = await getSession(); return { data: { user: result.data.session?.user ?? null }, error: result.error } },
    onAuthStateChange: (listener: Listener) => {
      listeners.add(listener)
      return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }
    },
    signInWithPassword: async (body: { email: string; password: string }) => {
      const result = await authCall('sign-in/email', body)
      if (!result.error) await notify('SIGNED_IN')
      return { data: { session: sessionFrom(result.data) }, error: result.error }
    },
    signUp: async (input: { email: string; password: string; options: { data: { name: string } } }) => {
      const result = await authCall('sign-up/email', { email: input.email, password: input.password, name: input.options.data.name })
      return { data: { user: result.data?.user ?? null, session: null }, error: result.error }
    },
    verifyOtp: async (input: { email?: string; token?: string; token_hash?: string }) => {
      if (!input.email || !input.token) return { data: { session: null }, error: { message: 'Request a new verification code and enter it here.' } }
      const result = await authCall('email-otp/verify-email', { email: input.email, otp: input.token })
      const data = result.error ? { session: null } : await notify('SIGNED_IN')
      return { data, error: result.error }
    },
    resend: ({ email }: { email: string }) => authCall('email-otp/send-verification-otp', { email, type: 'email-verification' }),
    signOut: async () => {
      const result = await authCall('sign-out', {})
      if (!result.error) listeners.forEach(listener => listener('SIGNED_OUT', null))
      return result
    },
    updateUser: async (input: { password: string; currentPassword?: string }) => authCall('change-password', {
      newPassword: input.password, currentPassword: input.currentPassword, revokeOtherSessions: true,
    }),
  }
  const storage = { from: () => ({
    upload: async (path: string, file: File) => {
      const response = await fetch(`/api/receipts/${path}`, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file, credentials: 'same-origin' })
      return { error: response.ok ? null : { message: 'Could not upload receipt.' } }
    },
    createSignedUrl: async (path: string) => ({ data: { signedUrl: `/api/receipts/${path}` }, error: null }),
  }) }
  // This adapter implements only the auth/storage calls used by Amountly.
  return Object.assign(rest, { auth, storage }) as unknown as SupabaseClient
}

export const changeRenderPassword = (currentPassword: string, newPassword: string) => authCall('change-password', { currentPassword, newPassword, revokeOtherSessions: true })
export const requestPasswordReset = (email: string) => authCall('email-otp/request-password-reset', { email })
export const resetPassword = (email: string, otp: string, password: string) => authCall('email-otp/reset-password', { email, otp, password })
