import { createClient } from '@supabase/supabase-js'

export class AiHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

// Imported only by the server route; no privileged/service-role client is used.
export async function authorizeAiRequest(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  if (!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(authorization)) {
    throw new AiHttpError(401, 'Sign in to use AI')
  }
  const origin = request.headers.get('origin')
  const requestUrl = new URL(request.url)
  // Next's development server may reconstruct a loopback request as localhost.
  // Accept only the equivalent HTTP loopback origin on the same port in dev.
  // Host/forwarded-host headers never expand the production origin allowlist.
  let localDevelopmentOrigin = false
  if (origin && process.env.NODE_ENV === 'development') {
    try {
      const browserUrl = new URL(origin)
      const loopback = new Set(['localhost', '127.0.0.1', '[::1]'])
      localDevelopmentOrigin = origin === browserUrl.origin
        && browserUrl.protocol === 'http:' && requestUrl.protocol === 'http:'
        && browserUrl.port === requestUrl.port
        && loopback.has(browserUrl.hostname) && loopback.has(requestUrl.hostname)
    } catch { /* Malformed origins remain denied. */ }
  }
  if (origin && origin !== requestUrl.origin && !localDevelopmentOrigin) {
    throw new AiHttpError(403, 'Request not allowed')
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new AiHttpError(503, 'AI is temporarily unavailable')

  const supabase = createClient(url, key, {
    global: {
      headers: { Authorization: authorization },
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
    },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await supabase.auth.getUser(authorization.slice(7))
  if (error || !data.user) throw new AiHttpError(401, 'Sign in to use AI')
  const { data: profile, error: profileError } = await supabase
    .from('users').select('is_active').eq('id', data.user.id).single()
  if (profileError) throw new AiHttpError(503, 'AI is temporarily unavailable')
  if (profile?.is_active !== true) throw new AiHttpError(403, 'AI access is unavailable for this account')
  return supabase
}
