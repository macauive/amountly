const test = require('node:test')
const assert = require('node:assert/strict')
const loadApp = require('./load-app.cjs')

test('cookie-authenticated writes require the Amountly origin regardless of Authorization', async t => {
  const origin = 'https://app.example.invalid'
  const forwarded = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }))
  const load = loadApp({
    '@/lib/platform/auth': {
      getAuth: () => ({ api: { getSession: async () => ({
        user: { id: '00000000-0000-4000-8000-000000000001', email: 'qa@example.invalid', emailVerified: true },
      }) } }),
      authPool: () => ({ query: async () => ({ rows: [{ is_active: true }] }) }),
    },
  }, { NEXT_PUBLIC_BACKEND: 'render', AMOUNTLY_APP_ORIGIN: origin,
    POSTGREST_JWT_SECRET: require('node:crypto').randomBytes(32).toString('hex') })
  const { PATCH } = load('src/app/api/data/[...path]/route.ts')
  function change(headers) {
    return PATCH(new Request(origin + '/api/data/expenses', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: 'test-session=synthetic', ...headers },
      body: JSON.stringify({ description: 'Synthetic change' }),
    }), { params: Promise.resolve({ path: ['expenses'] }) })
  }
  for (const headers of [{}, { Authorization: 'synthetic' }, { Origin: 'https://other.example.invalid' }]) {
    assert.equal((await change(headers)).status, 403)
  }
  assert.equal(forwarded.mock.callCount(), 0)
  assert.equal((await change({ Origin: origin })).status, 204)
  assert.equal(forwarded.mock.callCount(), 1)
})
