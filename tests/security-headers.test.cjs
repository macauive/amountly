const test = require('node:test')
const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const fixture = require('./auth-route-fixture.cjs')

test('HTTPS sessions use a host-only Secure cookie for sign-in, refresh and sign-out', async () => {
  const { browser, call, lastCode, store } = fixture()
  const email = 'cookie-test@example.invalid', password = randomBytes(16).toString('hex')
  const signup = await call('sign-up/email', { email, password, name: 'Cookie test' })
  assert.equal(signup.status, 200)
  browser.accept(signup)
  const verified = await call('email-otp/verify-email', { email, otp: lastCode() })
  assert.equal(verified.status, 200)

  function sessionCookie(response) {
    const cookies = response.headers.getSetCookie()
    const header = cookies.find(value => value.startsWith('__Host-amountly.session_token='))
    assert.ok(header, 'expected __Host- session cookie')
    const attributes = header.split('; ').slice(1).map(value => value.toLowerCase())
    for (const attribute of ['secure', 'httponly', 'samesite=lax', 'path=/']) assert.ok(attributes.includes(attribute))
    assert.ok(attributes.every(value => !value.startsWith('domain=')))
    assert.ok(cookies.every(value => !value.startsWith('__Secure-amountly.session_token=')))
    return header
  }
  sessionCookie(verified)
  browser.accept(verified)
  store.session[0].expiresAt = new Date(Date.now() + 60 * 60 * 1000)
  const refresh = await call('get-session')
  assert.equal((await refresh.json()).user.email, email)
  sessionCookie(refresh)
  browser.accept(refresh)
  const signOut = await call('sign-out', {})
  assert.equal(signOut.status, 200)
  assert.match(sessionCookie(signOut), /Max-Age=0/i)
  browser.accept(signOut)
  assert.equal(await (await call('get-session')).json(), null)
  sessionCookie(await call('sign-in/email', { email, password }))
})


test('the apex sends HSTS, with explicit opt-in for HTTPS-only subdomains', async () => {
  const loadApp = require('./load-app.cjs')
  for (const [setting, expected] of [[undefined, 'max-age=31536000'], ['true', 'max-age=31536000; includeSubDomains']]) {
    const config = loadApp({}, { AMOUNTLY_HSTS_INCLUDE_SUBDOMAINS: setting })('next.config.js')
    const headers = await config.headers()
    const matching = headers.filter(rule => rule.headers.some(header => header.key === 'Strict-Transport-Security'))
    assert.equal(matching.length, 1)
    assert.equal(matching[0].source, '/:path*')
    assert.equal(matching[0].has[0].type, 'host')
    assert.equal(matching[0].has[0].value, 'amountly\\.app')
    assert.equal(matching[0].headers[0].value, expected)
  }
})
