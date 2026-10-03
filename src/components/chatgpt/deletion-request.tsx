'use client'
import { useState } from 'react'
export function DeletionRequest() {
  const [status, setStatus] = useState(''), [busy, setBusy] = useState(false)
  return <div className="space-y-3"><p>Request removal of your account and associated data. Support reviews the request and explains any records that must be retained. Your account stays active while the request is pending.</p><button disabled={busy} className="rounded border px-4 py-3" onClick={async () => {
    setBusy(true)
    try { const response = await fetch('/api/account/deletion-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); setStatus(response.ok ? 'Deletion request recorded. Contact info@macdigital.ai for follow-up.' : 'Sign in and try again, or contact support.') }
    catch { setStatus('Could not record your request. Contact support.') } finally { setBusy(false) }
  }}>Request account deletion</button><p role="status">{status}</p></div>
}
