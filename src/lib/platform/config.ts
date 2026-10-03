// The legacy deployment stays usable until the verified Render cutover.
export const usesRenderBackend = process.env.NEXT_PUBLIC_BACKEND === 'render'

export function requiredSecret(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error('Server configuration is incomplete')
  return value
}

export function appOrigin(): string {
  const value = requiredSecret('AMOUNTLY_APP_ORIGIN')
  const url = new URL(value)
  const local = process.env.NODE_ENV !== 'production' && url.protocol === 'http:'
    && ['localhost', '127.0.0.1'].includes(url.hostname)
  if (url.origin !== value || (url.protocol !== 'https:' && !local)) throw new Error('Invalid app origin')
  return value
}
