const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const realAuth = require('better-auth')
const { memoryAdapter } = require('better-auth/adapters/memory')
const loadApp = require('./load-app.cjs')

module.exports = function authRouteFixture(options = {}) {
  const store = {}, messages = [], pending = []
  const origin = options.origin ?? 'https://amountly.example'
  class Pool {
    async query(sql, values) {
      if (sql.includes('select id from')) return { rows: store.user.filter(row => row.email === values[0] && !row.emailVerified) }
      if (sql.includes('and not "emailVerified"')) {
        return { rowCount: store.user.filter(row => row.id === values[0] && row.email === values[1] && !row.emailVerified).length }
      }
      if (sql.includes('where email =')) return { rowCount: store.user.filter(row => row.email === values[0]).length }
      if (sql.includes('select disabled')) return { rows: store.user.filter(row => row.id === values[0]) }
      assert.match(sql, /select is_active/)
      return { rows: [{ is_active: true }] }
    }
  }
  const load = loadApp({
    'better-auth': { ...realAuth, betterAuth(config) {
      for (const model of Object.keys(realAuth.getAuthTables(config))) store[model] = []
      const rateLimit = { ...config.rateLimit, storage: 'memory', enabled: !options.disableIpLimit }
      return realAuth.betterAuth({ ...config, database: memoryAdapter(store), rateLimit })
    } },
    'next/server': { after: fn => pending.push(fn) },
    pg: { Pool },
    '@/lib/platform/otp-limits': { reserveOtp: options.reserveOtp ?? (async () => true) },
    nodemailer: { createTransport(config) {
      assert.equal(config.host, 'smtp.resend.com')
      assert.equal(config.auth.user, 'resend')
      return { async sendMail(message) {
        await options.onMail?.(message)
        messages.push(message)
      }, close() {} }
    } },
    ...options.overrides,
  }, { NEXT_PUBLIC_BACKEND: 'render', AMOUNTLY_APP_ORIGIN: origin,
    NODE_ENV: origin.startsWith('https:') ? 'production' : 'development',
    AUTH_DATABASE_URL: 'postgresql://127.0.0.1/synthetic-auth', BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    RESEND_FROM: 'sender@example.invalid', RESEND_API_KEY: 'synthetic-api-key' })
  const route = load('src/app/api/auth/[...all]/route.ts')
  function newBrowser() {
    const cookies = new Map()
    return {
      accept(response) {
        for (const value of response.headers.getSetCookie()) {
          const [pair] = value.split(';')
          const separator = pair.indexOf('=')
          cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
        }
      },
      call(path, body) {
        return route[body ? 'POST' : 'GET'](new Request(origin + '/api/auth/' + path, {
          method: body ? 'POST' : 'GET',
          headers: { Origin: origin, Cookie: [...cookies].map(([key, value]) => key + '=' + value).join('; '),
            'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        }), { params: Promise.resolve({ all: path.split('/') }) })
      },
    }
  }
  const browser = newBrowser()
  return { browser, call: browser.call, newBrowser, store, messages, pending,
    flush: () => Promise.all(pending.splice(0).map(fn => fn())),
    lastCode: () => messages.at(-1).text.match(/code is (\d+)/)[1] }
}
