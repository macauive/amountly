'use client'
import { useState } from 'react'
export function Disconnect() {
  const [status, setStatus] = useState(''), [busy, setBusy] = useState(false)
  return <><button disabled={busy} className="rounded border px-4 py-3" onClick={async () => {
    setBusy(true)
    try { const response = await fetch('/api/chatgpt/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); setStatus(response.ok ? 'ChatGPT access has been revoked. Start linking again in ChatGPT to reconnect.' : 'Could not disconnect. Try again.') }
    catch { setStatus('Could not disconnect. Try again.') } finally { setBusy(false) }
  }}>Disconnect ChatGPT</button><p role="status">{status}</p></>
}
