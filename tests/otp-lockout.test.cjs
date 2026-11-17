const test = require('node:test')
const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const fixture = require('./auth-route-fixture.cjs')

for (const flow of ['signup', 'reset']) test(`${flow} code resends preserve the account attempt budget`, async () => {
  const attemptBudget = new Map()
  const { browser, call, lastCode, flush, store } = fixture({
    disableIpLimit: true,
    async reserveOtp(_pool, email, operation) {
      if (!operation.endsWith('-verify')) return true
      const key = email + ':' + operation
      const used = attemptBudget.get(key) ?? 0
      if (used >= 10) return false
      attemptBudget.set(key, used + 1)
      return true
    },
  })
  const email = 'otp-budget@example.invalid', password = randomBytes(16).toString('hex')
  const signup = await call('sign-up/email', { email, password, name: 'OTP budget test' })
  assert.equal(signup.status, 200)
  browser.accept(signup)
  async function send() {
    const response = flow === 'signup'
      ? await call('email-otp/send-verification-otp', { email, type: 'email-verification' })
      : await call('email-otp/request-password-reset', { email })
    assert.equal(response.status, 200)
    await flush()
  }
  if (flow === 'reset') await send()
  const key = email + ':' + flow + '-verify'
  const invalidGuess = () => lastCode().replace(/^./, first => first === '0' ? '1' : '0')
  const check = otp => flow === 'signup' ? call('email-otp/verify-email', { email, otp })
    : call('email-otp/reset-password', { email, otp, password })
  for (let round = 0; round < 3; round++) {
    for (let attempt = 0; attempt < 3; attempt++) assert.equal((await check(invalidGuess())).status, 400)
    await send()
    assert.equal(attemptBudget.get(key), 3 * (round + 1))
  }
  assert.equal((await check(invalidGuess())).status, 400)
  assert.equal(attemptBudget.get(key), 10)
  assert.equal((await check(lastCode())).status, 400)
  assert.equal(store.user[0].emailVerified, false)

  // Expiry of the persisted bucket is exercised against PostgreSQL separately.
  attemptBudget.delete(key)
  assert.equal((await check(lastCode())).status, 200)
  assert.equal(store.user[0].emailVerified, true)
})

test('wrong signup codes have one public response across account states', async () => {
  const { browser, call, newBrowser, lastCode } = fixture({ disableIpLimit: true })
  const email = 'wrong-code@example.invalid'
  const signup = await call('sign-up/email', { email, password: randomBytes(16).toString('hex'), name: 'Wrong code test' })
  assert.equal(signup.status, 200)
  browser.accept(signup)
  const otp = lastCode().replace(/^./, first => first === '0' ? '1' : '0')
  async function check(client, address) {
    const response = await client.call('email-otp/verify-email', { email: address, otp })
    return [response.status, await response.json()]
  }
  const unverified = await check(browser, email)
  assert.deepEqual(unverified, await check(newBrowser(), 'missing-code@example.invalid'))
  assert.equal((await call('email-otp/verify-email', { email, otp: lastCode() })).status, 200)
  assert.deepEqual(unverified, await check(browser, email))
})
