// Shared, browser-safe OAuth URL policy. No runtime configuration or secrets.
export function allowedClientDocument(value: string) {
  try {
    const url = new URL(value)
    return url.origin === 'https://chatgpt.com' && !url.username && !url.password && !value.includes('?') && !value.includes('#')
      && /^\/oauth\/(?:client\.json|[A-Za-z0-9_-]{1,128}\/client\.json|codex\/[A-Za-z0-9_-]{1,128}\/client\.json)$/.test(url.pathname)
  } catch { return false }
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
  if (!allowedClientDocument(clientId) || !allowedCallback(callback)) return false
  const client = new URL(clientId), redirect = new URL(callback)
  const codex = /^\/oauth\/codex(?:\/([A-Za-z0-9_-]{1,128}))?\/client\.json$/.exec(client.pathname)
  if (!codex) return redirect.origin === 'https://chatgpt.com'
  return redirect.protocol === 'http:' && redirect.pathname === '/callback' + (codex[1] ? '/' + codex[1] : '')
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
