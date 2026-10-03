import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import nodemailer from 'nodemailer'
import { POST as handle } from '../src/app/api/auth/[...all]/route'
import { authPool } from '../src/lib/platform/auth'

const url = new URL(process.env.RENDER_TEST_ADMIN_URL ?? '')
assert.equal(url.hostname,'127.0.0.1'); assert.equal(url.port,'54399'); assert.equal(url.pathname,'/render_rehearsal')
const owner = new Pool({connectionString:url.href,max:1})
const email = `auth-rehearsal-${randomUUID()}@example.invalid`
const password = randomBytes(24).toString('hex'), replacement = randomBytes(24).toString('hex')
let code = '', cookie = '', userId: string | undefined
// In-process transport replacement: this suite cannot send any real email.
const originalTransport = nodemailer.createTransport
nodemailer.createTransport = (() => ({ sendMail: async (message: {text:string;to:string}) => {
  assert.equal(message.to,email); code = message.text.match(/code is (\d{6})/)![1]
}, close() {} })) as unknown as typeof nodemailer.createTransport
async function call(path:string, body?:object, origin='http://127.0.0.1:4191') {
  return handle(new Request('http://127.0.0.1:4191/api/auth/'+path,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),{params:Promise.resolve({all:path.split('/')})})
}
async function main() {
  process.env.SMTP_FROM='sender@example.invalid';process.env.SMTP_USERNAME='sender@example.invalid';process.env.SMTP_PASSWORD=randomBytes(32).toString('hex')
  assert.equal((await call('sign-up/email',{email,password,name:'Synthetic auth test'},'https://evil.example')).status,403)
  const signup = await call('sign-up/email',{email,password,name:'Synthetic auth test'})
  assert.equal(signup.status,200)
  userId = (await signup.json()).user.id
  assert.ok(code)
  const stored = await owner.query('select value from amountly_auth.verification where identifier like $1',['%'+email+'%'])
  assert.ok(stored.rows.length);assert.ok(stored.rows.every(row=>!row.value.includes(code)), 'OTP stored hashed')
  assert.equal((await call('sign-in/email',{email,password})).status,403,'unverified account cannot sign in')
  assert.ok((await call('email-otp/verify-email',{email,otp:'not-an-otp'})).status>=400)
  const verification = await call('email-otp/verify-email',{email,otp:code})
  assert.equal(verification.status,200)
  cookie=verification.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
  assert.ok(cookie);assert.equal((await (await call('get-session')).json()).user.emailVerified,true)
  assert.equal((await call('email-otp/request-password-reset',{email})).status,200)
  const resetCode = code
  assert.equal((await call('email-otp/reset-password',{email,otp:resetCode,password:replacement})).status,200)
  assert.equal(await (await call('get-session')).json(),null,'reset revokes existing session')
  assert.ok((await call('email-otp/reset-password',{email,otp:resetCode,password})).status>=400,'reset code cannot be replayed')
  assert.equal((await call('sign-in/email',{email,password})).status,401,'old password rejected')
  assert.equal((await call('sign-in/email',{email,password:replacement})).status,200)
  console.log('PASS: signup verification, hashed single-use OTP, unverified denial, password reset, session revocation, old-password denial and new-password sign-in; no email sent')
}
main().catch(error=>{console.error(error.message);process.exitCode=1}).finally(async()=>{
  nodemailer.createTransport=originalTransport
  if(userId) { await owner.query('delete from amountly_auth."user" where id=$1',[userId]);await owner.query('delete from auth.users where id=$1',[userId]) }
  await owner.query('delete from amountly_auth.verification where identifier like $1',['%'+email+'%'])
  await owner.end();await authPool().end()
})
