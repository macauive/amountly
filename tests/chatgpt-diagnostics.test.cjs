const test = require('node:test')
const assert = require('node:assert/strict')
const loadApp = require('./load-app.cjs')

test('connection diagnostics expose only generated IDs and bounded metadata, never supplied errors', () => {
  const { createConnectionDiagnostics, ConnectionError } = loadApp()('src/lib/chatgpt/diagnostics.ts')
  const entries = [], diagnose = createConnectionDiagnostics(entry => entries.push(JSON.parse(entry)))
  const privateValue = 'synthetic-secret-never-log'
  const error = new ConnectionError(400, 'grant_inactive', privateValue)
  error.stack = privateValue
  const response = diagnose(Response.json({ error: 'invalid_grant' }, { status: 400 }), 'oauth:token', error)
  assert.equal(entries.length, 1)
  assert.deepEqual(Object.keys(entries[0]).sort(), ['event', 'reason', 'requestId', 'route', 'status'])
  assert.equal(entries[0].reason, 'grant_inactive')
  assert.equal(entries[0].requestId, response.headers.get('X-Amountly-Request-Id'))
  assert.match(entries[0].requestId, /^[0-9a-f-]{36}$/)
  diagnose(new Response(null, { status: 503 }), 'mcp', new Error(privateValue), privateValue)
  assert.equal(entries[1].reason, 'temporarily_unavailable')
  diagnose(new Response(null, { status: 400 }), 'oauth:token', undefined, privateValue)
  assert.equal(entries[2].reason, 'request_rejected')
  assert.equal(JSON.stringify(entries).includes(privateValue), false)
})

test('diagnostic volume is bounded and failures cannot break successful responses', () => {
  const { createConnectionDiagnostics, ConnectionError } = loadApp()('src/lib/chatgpt/diagnostics.ts')
  const entries = []; let now = 0
  const diagnose = createConnectionDiagnostics(entry => entries.push(entry), () => now)
  for (let i = 0; i < 100; i++) diagnose(new Response(null, { status: 429 }), 'mcp')
  assert.equal(entries.length, 10)
  diagnose(new Response(null, { status: 400 }), 'oauth:token', new ConnectionError(400, 'grant_inactive'))
  assert.equal(entries.length, 11, 'unrelated failures retain their diagnostic budget')
  now = 60_000
  diagnose(new Response(null, { status: 429 }), 'mcp')
  assert.equal(entries.length, 12)
  diagnose(new Response(null, { status: 200 }), 'mcp')
  assert.equal(entries.length, 12)
  const broken = createConnectionDiagnostics(() => { throw new Error('sink unavailable') })
  assert.equal(broken(new Response(null, { status: 401 }), 'mcp').status, 401)
})

test('refresh lifecycle lookup binds token and client; inactive rows fail closed', async () => {
  let rows = [], calls = 0
  const load = loadApp({ '@/lib/platform/auth': { authPool: () => ({ query: async (sql, values) => {
    calls++
    assert.match(sql, /t.token=\$1 and t\."clientId"=\$2/)
    assert.match(sql, /g.user_id=t\."userId"/)
    assert.match(sql, /s\."userId"=t\."userId"/)
    assert.match(values[0], /^[a-f0-9]{64}$/)
    assert.equal(values[1], 'amt_dcr_' + 'a'.repeat(43))
    return { rows }
  } }) } })
  const { requireRefreshConnection } = load('src/lib/chatgpt/lifecycle.ts')
  const values = new URLSearchParams({ grant_type: 'refresh_token', client_id: 'amt_dcr_' + 'a'.repeat(43), refresh_token: 'amt_rt_' + 'b'.repeat(32) })
  await requireRefreshConnection(new URLSearchParams({ grant_type: 'authorization_code' }))
  assert.equal(calls, 0)
  await requireRefreshConnection(values) // Unknown/replayed tokens still go to the provider.
  for (const [field, reason] of [['grantActive', 'grant_inactive'], ['sessionActive', 'session_inactive'], ['accountActive', 'account_inactive']]) {
    for (const inactive of [false, null, undefined]) {
      rows = [{ grantActive: true, sessionActive: true, accountActive: true, [field]: inactive }]
      await assert.rejects(requireRefreshConnection(values), error => error.reason === reason && error.status === 400)
    }
  }
  rows = [{ grantActive: true, sessionActive: true, accountActive: true }]
  await requireRefreshConnection(values)
})

test('lifecycle database outage fails closed before the provider can issue tokens', async () => {
  let providerCalls = 0
  const load = loadApp({
    '@/lib/platform/auth': {
      authPool: () => ({ query: async () => { throw new Error('synthetic-private-database-details') } }),
      getAuth: () => ({ handler: async () => { providerCalls++; return Response.json({ access_token: 'must-not-issue' }) } }),
    },
    '@/lib/chatgpt/rate-owner': { oauthRateOwner: async () => null },
  }, { NEXT_PUBLIC_BACKEND: 'render', AMOUNTLY_CHATGPT: 'enabled', AMOUNTLY_CHATGPT_DCR: 'enabled', AMOUNTLY_APP_ORIGIN: 'https://amountly.example' })
  const response = await load('src/app/api/auth/oauth2/[action]/route.ts').POST(new Request('https://amountly.example/api/auth/oauth2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: 'amt_dcr_' + 'a'.repeat(43), refresh_token: 'amt_rt_' + 'b'.repeat(32) }),
  }), { params: Promise.resolve({ action: 'token' }) })
  assert.equal(response.status, 503)
  assert.equal(providerCalls, 0)
  const body = await response.text()
  assert.equal(body.includes('synthetic-private-database-details'), false)
  assert.equal(body.includes('access_token'), false)
})
