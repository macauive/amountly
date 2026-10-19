// Shared, browser-safe OAuth URL policy. No runtime configuration or secrets.
// An identifier format, not proof of registration. The OAuth provider resolves
// these IDs from its client store and validates the stored callback and policy.
export function isDcrClientId(value: string) {
  return /^amt_dcr_[A-Za-z0-9_-]{43}$/.test(value)
}

export function allowedDcrWebCallback(value: string) {
  if (!allowedCallback(value)) return false
  const url = new URL(value)
  return url.origin === 'https://chatgpt.com' && url.href === value
}

// Canonical literal loopback hosts and existing callback paths only. The
// provider permits native listener-port selection; issued codes remain bound
// to the exact callback used for that authorization, including its port.
export function allowedDcrNativeCallback(value: string) {
  return allowedCallback(value) && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::[0-9]{1,5})?\/callback(?:\/[A-Za-z0-9_-]{1,128})?$/.test(value)
    && new URL(value).href === value
}

export function allowedDcrCallback(value: string) {
  return allowedDcrWebCallback(value) || allowedDcrNativeCallback(value)
}

export function allowedCallback(value: string) {
  try {
    const url = new URL(value)
    if (url.username || url.password || value.includes('?') || value.includes('#')) return false
    if (url.origin === 'https://chatgpt.com') return /^\/connector_platform_oauth_redirect(?:\/[A-Za-z0-9_-]{1,128})?$/.test(url.pathname)
    // Raw matching excludes URL-normalized numeric IP aliases and dot segments.
    const loopback = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::([0-9]{1,5}))?\/callback(?:\/[A-Za-z0-9_-]{1,128})?$/.exec(value)
    return !!loopback && (!loopback[1] || (Number(loopback[1]) > 0 && Number(loopback[1]) <= 65535))
  } catch { return false }
}

export function allowedClientCallback(clientId: string, callback: string) {
  return isDcrClientId(clientId) && allowedDcrCallback(callback)
}

export function allowedConnectionRedirect(value: string, query: string, origin: string) {
  try {
    const target = new URL(value, origin), fields = new URLSearchParams(query)
    if (target.username || target.password || value.includes('#')) return false
    if (target.origin === origin && target.pathname === '/chatgpt/consent') return true
    const callback = fields.get('redirect_uri') ?? ''
    if (!allowedClientCallback(fields.get('client_id') ?? '', callback)) return false
    const expected = new URL(callback)
    return target.origin === expected.origin && target.pathname === expected.pathname
      && target.searchParams.getAll('state').length === 1 && target.searchParams.get('state') === fields.get('state')
      && target.searchParams.getAll('iss').length === 1 && target.searchParams.get('iss') === origin + '/api/auth'
  } catch { return false }
}

// Registration metadata is self-asserted. A loopback DCR callback cannot prove
// the native application's identity, so do not label it ChatGPT or Codex.
export function connectionClientLabel(query: string) {
  const fields = new URLSearchParams(query), client = fields.get('client_id') ?? ''
  if (isDcrClientId(client) && allowedDcrNativeCallback(fields.get('redirect_uri') ?? '')) return 'your native MCP client'
  return 'ChatGPT'
}
