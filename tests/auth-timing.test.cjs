const test = require('node:test')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const { randomBytes } = require('node:crypto')
const fixture = require('./auth-route-fixture.cjs')

test('password reset response is independent of account state and slow or failed delivery', async t => {
  const { call, pending, flush } = fixture({ disableIpLimit: true, async onMail(message) {
    if (message.subject === 'Reset your Amountly password') {
      await delay(500)
      throw new Error('Simulated SMTP timeout')
    }
  } })
  const known = 'timing-known@example.invalid', unknown = 'timing-unknown@example.invalid'
  assert.equal((await call('sign-up/email', { email: known, name: 'Timing test', password: randomBytes(16).toString('hex') })).status, 200)
  const knownTimes = [], unknownTimes = []
  for (let index = 0; index < 10; index++) {
    const email = index % 2 === 0 ? known : unknown
    const start = performance.now()
    const response = await call('email-otp/request-password-reset', { email })
    ;(email === known ? knownTimes : unknownTimes).push(performance.now() - start)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { success: true })
  }
  function median(times) { return times.sort((a, b) => a - b)[2] }
  const delta = Math.abs(median(knownTimes) - median(unknownTimes))
  t.diagnostic(`Median timing delta across ten alternating requests: ${delta.toFixed(1)} ms`)
  assert.ok(delta < 100)
  assert.equal(pending.length, 5)
  await flush()
})
