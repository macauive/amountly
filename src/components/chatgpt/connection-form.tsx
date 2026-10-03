'use client'
import { useState } from 'react'

export function ConnectionForm({ query, consent = false }: { query: string; consent?: boolean }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function connect(form: HTMLFormElement, accept = true) {
    setBusy(true); setError('')
    try {
      const values = new FormData(form)
      const response = await fetch(consent ? '/api/auth/oauth2/consent' : '/api/auth/sign-in/email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify(consent ? { accept, oauth_query: query } : { email: values.get('email'), password: values.get('password'), oauth_query: query }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error('Could not connect. Check your details or start again in ChatGPT.')
      const url = new URL(result.url ?? result.redirect_uri, window.location.origin)
      const internal = url.origin === window.location.origin && url.pathname === '/chatgpt/consent'
      const callback = url.origin === 'https://chatgpt.com' && /^\/connector_platform_oauth_redirect(?:\/[A-Za-z0-9_-]{1,128})?$/.test(url.pathname)
      if (!internal && !callback) throw new Error('Could not finish linking. Start again in ChatGPT.')
      window.location.assign(url.href)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not connect.'); setBusy(false) }
  }
  return <form onSubmit={event => { event.preventDefault(); void connect(event.currentTarget) }} className="space-y-4">
    {!consent && <>
      <label className="block">Email<input name="email" type="email" autoComplete="username" required maxLength={254} className="mt-1 block w-full rounded border p-3 bg-background" /></label>
      <label className="block">Password<input name="password" type="password" autoComplete="current-password" required maxLength={128} className="mt-1 block w-full rounded border p-3 bg-background" /></label>
      <p className="text-sm text-muted-foreground">Use an existing, verified Amountly account. <a href="/login" className="underline">Account help</a></p>
    </>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <button disabled={busy} className="w-full rounded bg-primary px-4 py-3 text-primary-foreground disabled:opacity-60">{busy ? 'Connecting…' : consent ? 'Allow read-only access' : 'Sign in to Amountly'}</button>
    {consent && <button type="button" disabled={busy} onClick={event => { const form = event.currentTarget.form; if (form) void connect(form, false) }} className="w-full rounded border px-4 py-3">Cancel</button>}
  </form>
}
