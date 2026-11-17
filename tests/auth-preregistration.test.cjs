const test = require('node:test')
const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const fixture = require('./auth-route-fixture.cjs')

test('duplicate signup requires account recovery and only the replacement password works after reset', async () => {
  const { call, newBrowser, messages, lastCode, flush, store } = fixture()
  const recovery = newBrowser()
  const email = 'pending@example.invalid'
  const initial = randomBytes(16).toString('hex'), replacement = randomBytes(16).toString('hex')
  const signup = await call('sign-up/email', { email, password: initial, name: 'Pending test account' })
  assert.equal(signup.status, 200)
  assert.equal(await (await call('get-session')).json(), null)

  const duplicate = await recovery.call('sign-up/email', { email: ' PENDING@example.invalid ', password: replacement, name: 'Duplicate' })
  assert.equal(duplicate.status, 409)
  assert.equal((await duplicate.json()).code, 'ACCOUNT_EXISTS')
  assert.deepEqual(duplicate.headers.getSetCookie(), [])
  assert.ok(signup.headers.getSetCookie().some(cookie => cookie.startsWith('__Host-amountly.signup=')))
  assert.equal(store.user.length, 1)
  assert.equal(messages.length, 1)
  assert.equal(await (await recovery.call('get-session')).json(), null)

  assert.equal((await recovery.call('email-otp/send-verification-otp', { email, type: 'email-verification' })).status, 400)
  assert.equal(messages.length, 1)

  assert.equal((await recovery.call('email-otp/request-password-reset', { email })).status, 200)
  await flush()
  assert.equal((await recovery.call('email-otp/reset-password', { email, otp: lastCode(), password: replacement })).status, 200)
  assert.equal((await recovery.call('sign-in/email', { email, password: initial })).status, 401)
  assert.equal((await recovery.call('sign-in/email', { email, password: replacement })).status, 200)

  const verifiedDuplicate = await recovery.call('sign-up/email', { email, password: initial, name: 'Duplicate' })
  assert.equal(verifiedDuplicate.status, 409)
  assert.equal((await verifiedDuplicate.json()).code, 'ACCOUNT_EXISTS')
  assert.deepEqual(verifiedDuplicate.headers.getSetCookie(), [])
  assert.equal(messages.length, 2)
  assert.equal(store.user.length, 1)
})
