const test = require('node:test')
const assert = require('node:assert/strict')
const loadApp = require('./load-app.cjs')

function mailer(env = {}, fail = false) {
  const configurations = [], messages = []
  let closed = 0
  const load = loadApp({ nodemailer: { createTransport(configuration) {
    configurations.push(configuration)
    return { async sendMail(message) {
      messages.push(message)
      if (fail) throw new Error('private SMTP diagnostic with credentials and code')
    }, close() { closed++ } }
  } } }, { RESEND_FROM: 'sender@example.invalid', RESEND_API_KEY: 'synthetic-api-key', ...env })
  return { send: load('src/lib/platform/auth-email.ts').sendAuthCode, configurations, messages, closed: () => closed }
}

test('verification and password reset use only Resend with mandatory certificate-verified TLS', async () => {
  const mail = mailer()
  for (const type of ['email-verification', 'forget-password']) {
    await mail.send('recipient@example.invalid', '123456', type)
  }
  assert.equal(mail.configurations.length, 2)
  for (const configuration of mail.configurations) {
    assert.deepEqual(JSON.parse(JSON.stringify(configuration)), {
      host: 'smtp.resend.com', port: 587, secure: false, requireTLS: true,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      auth: { user: 'resend', pass: 'synthetic-api-key' },
      connectionTimeout: 10000, socketTimeout: 15000, logger: false, debug: false,
    })
  }
  assert.equal(mail.messages[0].subject, 'Verify your Amountly email')
  assert.equal(mail.messages[1].subject, 'Reset your Amountly password')
  for (const message of mail.messages) {
    assert.equal(message.from.name, 'Amountly')
    assert.equal(message.from.address, 'sender@example.invalid')
    assert.equal(message.to, 'recipient@example.invalid')
    assert.match(message.text, /123456.*expires in 10 minutes/)
    assert.match(message.text, /If you did not request this, ignore this email/)
  }
  assert.equal(mail.closed(), 2)
})

test('missing Resend settings fail before connecting and never fall back to Proton', async () => {
  for (const env of [{ RESEND_FROM: '' }, { RESEND_API_KEY: '' }, { RESEND_FROM: 'bad\r\nBcc: recipient@example.invalid' }]) {
    const mail = mailer({ SMTP_FROM: 'old@example.invalid', SMTP_USERNAME: 'old', SMTP_PASSWORD: 'synthetic-old-password', ...env })
    await assert.rejects(mail.send('recipient@example.invalid', '123456', 'email-verification'), /configuration/)
    assert.equal(mail.configurations.length, 0)
  }
})

test('invalid recipients, codes and unsupported purposes cannot reach the transport', async () => {
  const mail = mailer()
  for (const args of [
    ['recipient@example.invalid\r\nBcc: other@example.invalid', '123456', 'email-verification'],
    ['recipient@example.invalid', '12345', 'email-verification'],
    ['recipient@example.invalid', '123456\n', 'forget-password'],
    ['recipient@example.invalid', '123456', 'sign-in'],
  ]) await assert.rejects(mail.send(...args), /^Error: Invalid authentication email$/)
  assert.equal(mail.configurations.length, 0)
})

test('SMTP failure is generic and always closes the transport', async () => {
  const mail = mailer({}, true)
  await assert.rejects(mail.send('recipient@example.invalid', '123456', 'forget-password'), /^Error: Authentication email could not be sent$/)
  assert.equal(mail.closed(), 1)
})

test('verification UI accepts the active backend code length and submits the received code', async () => {
  const React = require('react')
  for (const [backend, code] of [['render', '123456'], ['supabase', '12345678']]) {
    const states = [code, 'recipient@example.invalid', null, null, false, false]
    const submitted = [], routes = []
    const load = loadApp({
      react: { ...React, useState: () => [states.shift(), () => {}], useEffect: () => {}, useMemo: fn => fn() },
      'next/navigation': { useRouter: () => ({ replace: path => routes.push(path) }), useSearchParams: () => new URLSearchParams() },
      '@/components/ui/button': { Button: 'button' },
      '@/components/ui/card': Object.fromEntries(['Card', 'CardContent', 'CardDescription', 'CardFooter', 'CardHeader', 'CardTitle'].map(name => [name, name])),
      '@/components/ui/input': { Input: 'input' },
      '@/components/ui/input-otp': { InputOTP: 'input-otp', InputOTPGroup: 'otp-group', InputOTPSlot: 'otp-slot' },
      '@/components/ui/label': { Label: 'label' },
      '@/contexts/AuthContext': { useAuth: () => ({ isLoading: false, verifyEmailOtp: async values => {
        submitted.push(values); return { error: null, nextPath: '/account-type' }
      } }) },
    }, { NEXT_PUBLIC_BACKEND: backend })
    const page = load('src/app/(auth)/verify/page.tsx').default()
    const tree = page.props.children.type()
    const nodes = []
    function visit(node) {
      if (Array.isArray(node)) return node.forEach(visit)
      if (!node || typeof node !== 'object') return
      nodes.push(node); visit(node.props?.children)
    }
    visit(tree)
    assert.equal(nodes.find(node => node.props?.id === 'verification-code').props.maxLength, code.length)
    const button = nodes.find(node => node.props?.onClick && JSON.stringify(node.props.children).includes('Verify code'))
    await button.props.onClick()
    assert.deepEqual(JSON.parse(JSON.stringify(submitted)), [{ email: 'recipient@example.invalid', token: code, type: 'signup' }])
    assert.deepEqual(routes, ['/account-type'])
  }
})

test('real auth routes verify signup and reset passwords with hashed single-use codes through Resend', async () => {
  const realAuth = require('better-auth')
  const { memoryAdapter } = require('better-auth/adapters/memory')
  const { randomBytes } = require('node:crypto')
  const store = {}, messages = []
  const origin = 'https://amountly.example'
  const email = 'auth-flow@example.invalid'
  const password = randomBytes(24).toString('hex'), replacement = randomBytes(24).toString('hex')
  let cookie = ''
  class Pool {
    async query(sql, values) {
      if (sql.includes('select disabled')) return { rows: store.user.filter(row => row.id === values[0]) }
      assert.match(sql, /select is_active/)
      return { rows: [{ is_active: true }] }
    }
  }
  const load = loadApp({
    'better-auth': { ...realAuth, betterAuth(options) {
      for (const model of Object.keys(realAuth.getAuthTables(options))) store[model] = []
      return realAuth.betterAuth({ ...options, database: memoryAdapter(store), rateLimit: { ...options.rateLimit, storage: 'memory' } })
    } },
    pg: { Pool },
    nodemailer: { createTransport(options) {
      assert.equal(options.host, 'smtp.resend.com')
      assert.equal(options.auth.user, 'resend')
      return { async sendMail(message) { messages.push(message) }, close() {} }
    } },
  }, { NEXT_PUBLIC_BACKEND: 'render', AMOUNTLY_APP_ORIGIN: origin, NODE_ENV: 'production',
    AUTH_DATABASE_URL: 'postgresql://127.0.0.1/synthetic-auth', BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    RESEND_FROM: 'sender@example.invalid', RESEND_API_KEY: 'synthetic-api-key' })
  const route = load('src/app/api/auth/[...all]/route.ts')
  async function call(path, body) {
    return route[body ? 'POST' : 'GET'](new Request(origin + '/api/auth/' + path, {
      method: body ? 'POST' : 'GET', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }), { params: Promise.resolve({ all: path.split('/') }) })
  }
  const lastCode = () => messages.at(-1).text.match(/code is (\d{6})/)[1]
  assert.equal((await call('sign-up/email', { email, password, name: 'Synthetic auth test' })).status, 200)
  assert.equal(messages.at(-1).subject, 'Verify your Amountly email')
  assert.equal(messages.at(-1).to, email)
  let code = lastCode()
  assert.ok(store.verification.length)
  assert.ok(store.verification.every(row => !row.value.includes(code)), 'only hashed codes are stored')
  assert.equal((await call('sign-in/email', { email, password })).status, 403)
  assert.equal((await call('email-otp/send-verification-otp', { email, type: 'email-verification' })).status, 200)
  code = lastCode()
  const verified = await call('email-otp/verify-email', { email, otp: code })
  assert.equal(verified.status, 200)
  cookie = verified.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.ok(cookie)
  assert.equal((await verified.json()).token, undefined, 'browser never receives a session token')
  assert.equal((await (await call('get-session')).json()).user.emailVerified, true)
  assert.equal((await call('email-otp/request-password-reset', { email })).status, 200)
  assert.equal(messages.at(-1).subject, 'Reset your Amountly password')
  const resetCode = lastCode()
  assert.ok(store.verification.every(row => !row.value.includes(resetCode)))
  assert.equal((await call('email-otp/reset-password', { email, otp: resetCode, password: replacement })).status, 200)
  assert.equal(await (await call('get-session')).json(), null, 'reset revokes existing sessions')
  assert.ok((await call('email-otp/reset-password', { email, otp: resetCode, password })).status >= 400, 'reset code cannot be reused')
  assert.equal((await call('sign-in/email', { email, password })).status, 401)
  assert.equal((await call('sign-in/email', { email, password: replacement })).status, 200)
})
