// Only deployment configuration supplies the backend origin; never request headers.
export function contentSecurityPolicy(nonce: string, backendUrl: string | undefined, development: boolean) {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(nonce)) throw new Error('Invalid CSP nonce')
  const connections = ["'self'"]
  if (backendUrl) {
    const backend = new URL(backendUrl)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(backend.hostname)
    if (backend.protocol !== 'https:' && !(loopback && backend.protocol === 'http:')) throw new Error('Invalid backend origin')
    connections.push(backend.origin, backend.origin.replace(/^http/, 'ws'))
  }
  if (development) connections.push('ws://localhost:*', 'ws://127.0.0.1:*')
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    // Radix positioning, charts and theme transitions require inline styles.
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connections.join(' ')}`,
    "img-src 'self' blob: data:", "font-src 'self'", "worker-src 'self' blob:",
    "object-src 'none'", "frame-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ')
}
