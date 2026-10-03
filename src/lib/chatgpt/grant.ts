import { createHash } from 'node:crypto'
import { getAuth, authPool } from '@/lib/platform/auth'
import { AiHttpError } from '@/lib/ai/server'
import { allowedCallback } from '@/lib/chatgpt/config'

export async function recordIssuedGrant(request: Request, response: Response) {
  if (!response.ok && response.status !== 302) return
  let target = response.headers.get('location')
  if (!target && response.headers.get('content-type')?.includes('application/json')) {
    const value = await response.clone().json(); target = value.url ?? value.redirect_uri
  }
  if (!target) return
  const callback = new URL(target, request.url), code = callback.searchParams.get('code')
  if (!code || !allowedCallback(callback.origin+callback.pathname)) return
  if (code.length < 20 || code.length > 200) throw new AiHttpError(503, 'Connection could not be completed')
  // Sign-in can issue a code directly after an existing consent. Read the new
  // HttpOnly cookie on the server without exposing it to browser JavaScript.
  const cookies = new Map<string,string>((request.headers.get('cookie') ?? '').split(';').map(cookie => {
    const index=cookie.indexOf('='); return [cookie.slice(0,index).trim(),cookie.slice(index+1)] as [string,string]
  }).filter(([key]) => key))
  for (const value of response.headers.getSetCookie()) {
    const cookie=value.split(';')[0], index=cookie.indexOf('=')
    cookies.set(cookie.slice(0,index),cookie.slice(index+1))
  }
  const headers = new Headers(request.headers)
  headers.set('cookie',[...cookies].map(([key,value])=>`${key}=${value}`).join('; '))
  const session = await getAuth().api.getSession({ headers, query: { disableCookieCache: true } })
  if (!session?.user.emailVerified || session.user.disabled || (session.user.bannedUntil && new Date(session.user.bannedUntil)>new Date())) throw new AiHttpError(401, 'Sign in to continue')
  const active=await authPool().query('select is_active from public.users where id=$1',[session.user.id])
  if (active.rows[0]?.is_active!==true) throw new AiHttpError(403, 'Account unavailable')
  await authPool().query('insert into amountly_auth.mcp_grants(authorization_code_id,user_id) values($1,$2) on conflict do nothing',
    [createHash('sha256').update(code).digest('hex'),session.user.id])
}
