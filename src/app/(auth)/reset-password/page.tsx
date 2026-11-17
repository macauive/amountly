'use client'
import { useState } from 'react'
import Link from 'next/link'
import { requestPasswordReset, resetPassword } from '@/lib/platform/browser'
import { authCodeLength, authCodePattern } from '@/lib/platform/otp-code'
import { usesRenderBackend } from '@/lib/platform/config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function ResetPassword() {
  const [email, setEmail] = useState(''), [code, setCode] = useState(''), [password, setPassword] = useState('')
  const [sent, setSent] = useState(false), [done, setDone] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('')
    const result = sent ? await resetPassword(email, code, password) : await requestPasswordReset(email)
    if (result.error) setMessage(result.error.message)
    else if (sent) { setDone(true); setPassword(''); setCode('') }
    else { setSent(true); setMessage('If this address has an account, you will receive a reset code.') }
    setBusy(false)
  }
  async function resend() {
    setBusy(true)
    const result = await requestPasswordReset(email)
    setMessage(result.error?.message ?? 'If this address has an account, you will receive a reset code.')
    setBusy(false)
  }
  return <Card><CardHeader><CardTitle>Reset your password</CardTitle></CardHeader><CardContent>
    {!usesRenderBackend ? <p>Password recovery is not available here yet.</p> : done ? <p>Your password has been reset. Sign in with your new password.</p> :
      <form onSubmit={submit} className="space-y-4">
        <div><Label htmlFor="reset-email">Email</Label><Input id="reset-email" type="email" autoComplete="email" required maxLength={254} value={email} disabled={sent} onChange={e => setEmail(e.target.value)} /></div>
        {sent && <><div><Label htmlFor="reset-code">Verification code</Label><Input id="reset-code" inputMode="numeric" autoComplete="one-time-code" required pattern={authCodePattern} maxLength={authCodeLength} value={code} onChange={e => setCode(e.target.value)} /></div>
          <div><Label htmlFor="reset-password">New password</Label><Input id="reset-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} /><p className="text-sm text-muted-foreground">Use at least 12 characters.</p></div></>}
        {message && <p role="status">{message}</p>}
        <Button type="submit" disabled={busy}>{busy ? 'Please wait…' : sent ? 'Reset password' : 'Send reset code'}</Button>
        {sent && <Button type="button" variant="outline" disabled={busy} onClick={resend}>Resend reset code</Button>}
      </form>}
    <Link href="/login" className="mt-4 block text-primary underline">Back to sign in</Link>
  </CardContent></Card>
}
