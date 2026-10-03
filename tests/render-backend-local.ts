import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { Pool } from 'pg'
import { hash } from 'bcryptjs'

// Refuse deployed destinations. This suite mutates only a disposable rehearsal.
const url = new URL(process.env.RENDER_TEST_ADMIN_URL ?? '')
assert.equal(url.hostname, '127.0.0.1')
assert.equal(url.port, '54399')
assert.equal(url.pathname, '/render_rehearsal')
const database = new Pool({ connectionString: url.href, max: 1 })
const base = process.env.RENDER_TEST_CONTAINER === 'true' ? 'http://127.0.0.1:4192' : 'http://127.0.0.1:4191'
const origin = process.env.RENDER_TEST_CONTAINER === 'true' ? 'https://amountly.local.invalid' : base
const password = randomBytes(24).toString('hex')
const ids = [randomUUID(), randomUUID()]
const emails = ids.map(id => `rehearsal-${id}@example.invalid`)
let cookie = ''
async function api(path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) {
  return fetch(base + path, { method, headers: { Origin: origin, Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' })
}
async function main() {
  for (let index=0; index<ids.length; index++) {
    await database.query('insert into amountly_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt",disabled) values($1,\'Synthetic migration test\',$2,true,now(),now(),false)', [ids[index],emails[index]])
    await database.query('insert into amountly_auth.account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") values($1,$2::text,\'credential\',$2::uuid,$3,now(),now())', [randomUUID(),ids[index],await hash(password,10)])
    await database.query("set request.jwt.claims = '{\"role\":\"service_role\"}'")
    await database.query("insert into public.users(id,email,name,role,account_type,is_active) values($1,$2,'Synthetic migration test','MEMBER','personal',true)", [ids[index],emails[index]])
  }
  assert.equal((await api('/api/data/users')).status,401)
  assert.equal((await api('/api/data/rpc/set_own_preferences','POST',{preferences:{}})).status,401)
  const login = await api('/api/auth/sign-in/email','POST',{email:emails[0],password})
  assert.equal(login.status,200, 'bcrypt account signs in')
  assert.ok(login.headers.get('set-cookie')?.includes('HttpOnly'))
  assert.ok(login.headers.get('set-cookie')?.includes('SameSite=Lax'))
  if (process.env.RENDER_TEST_CONTAINER === 'true') assert.ok(login.headers.get('set-cookie')?.includes('Secure'))
  cookie = login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
  assert.ok(cookie)
  const loggedIn = await login.json()
  assert.equal(loggedIn.token,undefined)
  const session = await (await api('/api/auth/get-session')).json()
  assert.equal(session.user.id,ids[0]); assert.equal(session.session.token,undefined)
  let response = await api('/api/data/users?select=id')
  assert.equal(response.status,200)
  assert.deepEqual(await response.json(),[{id:ids[0]}], 'RLS hides other users and imported accounts')
  assert.equal((await api('/api/data/users?select=id','GET',undefined,{'Accept-Profile':'amountly_auth'})).status,200)
  assert.equal((await api('/api/data/account')).status,404)
  for (const table of ['invoice_line_items', 'invoice_payment_reversals']) {
    const exported = await api('/api/data/'+table+'?select=id')
    assert.equal(exported.status,200)
    assert.deepEqual(await exported.json(),[], 'export tables retain RLS')
    assert.equal((await api('/api/data/'+table,'POST',{})).status,405)
  }
  assert.equal((await api('/api/data/rpc/arbitrary_sql','POST',{sql:'select 1'})).status,404)
  assert.equal((await api('/api/data/users','PATCH',{name:'Forged'},{Origin:'https://evil.example'})).status,403)
  response = await api('/api/data/users?id=eq.'+ids[0],'PATCH',{role:'OWNER'},{Prefer:'return=representation'})
  assert.ok([400,403].includes(response.status),'cannot promote own role')
  const ownRole = await (await api('/api/data/users?select=role')).json()
  assert.deepEqual(ownRole,[{role:'MEMBER'}])
  response = await api('/api/data/users?id=eq.'+ids[1],'PATCH',{name:'Forged'},{Prefer:'return=representation'})
  assert.equal(response.status,200); assert.deepEqual(await response.json(),[])
  const invalidFile = await fetch(base+'/api/receipts/upload',{method:'PUT',headers:{Origin:origin,Cookie:cookie,'Content-Type':'image/png'},body:'not a png'})
  assert.equal(invalidFile.status,415)
  const file = await fetch(base+'/api/receipts/upload',{method:'PUT',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/pdf'},body:'%PDF-1.7\nSynthetic test receipt\n%%EOF'})
  assert.equal(file.status,201)
  const {path}=await file.json()
  assert.ok(path.startsWith(ids[0]+'/'))
  assert.equal((await api('/api/receipts/'+path)).status,200)
  await database.query('update public.users set is_active=false where id=$1',[ids[0]])
  assert.equal((await api('/api/data/users')).status,403, 'disablement takes effect on an existing session')
  await database.query('update public.users set is_active=true where id=$1',[ids[0]])
  const oldCookie = cookie
  assert.equal((await api('/api/auth/sign-out','POST',{})).status,200)
  assert.equal((await api('/api/data/users')).status,401,'revoked cookie rejected')
  const otherLogin = await api('/api/auth/sign-in/email','POST',{email:emails[1],password})
  assert.equal(otherLogin.status,200)
  cookie = otherLogin.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
  assert.equal((await api('/api/receipts/'+path)).status,404,'foreign receipts denied')
  assert.equal((await api('/api/data/users','GET',undefined,{Cookie:oldCookie})).status,401)
  console.log('PASS: bcrypt sign-in, HttpOnly sessions, token withholding, RLS isolation, schema allowlist, CSRF, role escalation denial, receipts, disablement and revocation')
}
main().catch(error => { console.error(error.message); process.exitCode=1 }).finally(async () => {
  // Synthetic rows only, identified by fresh random UUIDs from this invocation.
  for (const id of ids) {
    await database.query('delete from amountly_files.receipts where owner_id=$1',[id]).catch(()=>{})
    await database.query('delete from amountly_auth."user" where id=$1',[id]).catch(()=>{})
    await database.query('delete from public.users where id=$1',[id]).catch(()=>{})
    await database.query('delete from auth.users where id=$1',[id]).catch(()=>{})
  }
  await database.end()
})
