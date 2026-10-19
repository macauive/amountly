const test = require('node:test')
const assert = require('node:assert/strict')
const { randomBytes, createHash } = require('node:crypto')
const { betterAuth, getAuthTables } = require('better-auth')
const { memoryAdapter } = require('better-auth/adapters/memory')
const { oauthProvider, getOAuthProviderApi } = require('@better-auth/oauth-provider')
const { createAuthEndpoint } = require('better-auth/api')
const { z } = require('zod')
const loadApp = require('./load-app.cjs')
const origin = 'https://amountly.example', resource = origin + '/mcp'
const callback = 'https://chatgpt.com/connector_platform_oauth_redirect'
const metadata = { client_name: 'ChatGPT', redirect_uris: [callback], token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: 'amountly:read offline_access' }

async function harness(enabled = true) {
  const store = {}, grants = [], counters = new Map()
  let auth, provider, active = true
  class BoundaryError extends Error { constructor(status, message) { super(message); this.status = status } }
  const query = async (sql, values) => {
    if (sql.startsWith('select is_active')) return { rows: [{ is_active: active }] }
    if (sql.includes('insert into amountly_auth.mcp_rate')) {
      counters.set(values[0], (counters.get(values[0]) ?? 0) + 1)
      return { rows: [{ count: counters.get(values[0]) }] }
    }
    if (sql.includes('insert into amountly_auth.mcp_grants')) { grants.push(values); return { rows: [] } }
    if (sql.includes('select v.value')) {
      const verification = store.verification.find(row => row.identifier === values[0])
      const grant = grants.find(row => row[0] === values[0])
      return { rows: verification && grant ? [{ value: verification.value, user_id: grant[1] }] : [] }
    }
    if (sql.includes('select t."userId"')) {
      const table = sql.includes('"oauthRefreshToken"') ? 'oauthRefreshToken' : 'oauthAccessToken'
      return { rows: store[table].filter(row => row.token === values[0] && row.clientId === values[1] && !row.revoked)
        .map(row => ({ userId: row.userId, sessionId: row.sessionId })) }
    }
    if (sql.includes('select a."clientId"')) return { rows: store.oauthAccessToken
      .filter(row => row.token === values[0] && grants.some(grant => grant[0] === row.authorizationCodeId))
      .map(row => ({ clientId: row.clientId })) }
    if (sql.includes('select u.id')) return { rows: store.user.filter(row => row.id === values[0] && row.emailVerified
      && (!values[1] || store.session.some(session => session.id === values[1])))
      .map(row => ({ ...row, is_active: active })) }
    if (sql.includes('mcp_audit')) return { rows: [] }
    throw new Error('Unexpected local database operation')
  }
  const overrides = {
    '@/lib/platform/auth': { getAuth: () => auth, authPool: () => ({ query }) },
    '@/lib/platform/server': { validateOrigin: () => {}, clientForIdentity: async identity => dataClient(identity.id),
      requireIdentity: async headers => {
        const session = await auth.api.getSession({ headers })
        if (!session || !active) throw new BoundaryError(401, 'Sign in')
        return session.user
      } },
    '@/lib/ai/server': { AiHttpError: BoundaryError },
  }
  const load = loadApp(overrides, { AMOUNTLY_APP_ORIGIN: origin, NEXT_PUBLIC_BACKEND: 'render', AMOUNTLY_CHATGPT: 'enabled',
    AMOUNTLY_CHATGPT_DCR: enabled ? 'enabled' : undefined, NODE_ENV: 'production' })
  provider = oauthProvider(load('src/lib/chatgpt/oauth.ts').oauthOptions())
  for (const model of Object.keys(getAuthTables({ plugins: [provider] }))) store[model] = []
  auth = betterAuth({ baseURL: origin, secret: randomBytes(32).toString('hex'), database: memoryAdapter(store),
    trustedOrigins: [origin], emailAndPassword: { enabled: true }, logger: { disabled: true },
    advanced: { database: { generateId: 'uuid' } }, plugins: [provider, { id: 'amountly-protected-resource', endpoints: {
      validateAmountlyToken: createAuthEndpoint('/internal/amountly-token', {
        method: 'POST', body: z.object({ token: z.string().max(256), clientId: z.string().max(256) }),
      }, async ctx => getOAuthProviderApi(ctx, provider.options).requireActiveAccessToken(ctx.body.token, ctx.body.clientId)),
    } }] })
  const password = randomBytes(24).toString('hex'), email = 'synthetic-dcr@example.invalid'
  const signup = await auth.api.signUpEmail({ body: { name: 'Synthetic DCR', email, password } })
  await (await auth.$context).internalAdapter.updateUser(signup.user.id, { emailVerified: true })
  const login = await auth.api.signInEmail({ body: { email, password }, asResponse: true })
  assert.equal(login.status, 200)
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const route = load('src/app/api/auth/oauth2/[action]/route.ts')
  async function call(action, values = {}, options = {}) {
    const method = action === 'authorize' ? 'GET' : 'POST'
    const json = ['register', 'consent'].includes(action)
    const headers = { ...(json ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'application/x-www-form-urlencoded' }),
      ...(['authorize', 'consent'].includes(action) ? { Cookie: cookie, Origin: origin, Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' } : {}), ...options.headers }
    const query = method === 'GET' ? '?' + new URLSearchParams(values) : ''
    const body = method === 'GET' ? undefined : options.raw ?? (json ? JSON.stringify(values) : new URLSearchParams(values).toString())
    return route[method](new Request(origin + '/api/auth/oauth2/' + action + query, { method, headers, body }),
      { params: Promise.resolve({ action }) })
  }
  async function register(input = metadata) {
    const response = await call('register', input)
    assert.equal(response.status, 201)
    const value = await response.json()
    assert.match(value.client_id, /^amt_dcr_[A-Za-z0-9_-]{43}$/)
    assert.equal(value.token_endpoint_auth_method, 'none')
    assert.equal(value.client_secret, undefined)
    return value.client_id
  }
  async function authorize(clientId, overrides = {}, accept = true) {
    const verifier = randomBytes(32).toString('base64url')
    const fields = { client_id: clientId, redirect_uri: callback, response_type: 'code', resource,
      scope: 'amountly:read offline_access', state: 'synthetic-state', code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), prompt: 'consent', ...overrides }
    const response = await call('authorize', fields)
    if (response.status !== 302) return { response }
    const location = new URL(response.headers.get('location'), origin)
    if (location.pathname === '/api/auth/error') {
      assert.equal(location.origin, origin)
      assert.equal(location.searchParams.has('code'), false)
      return { response, rejected: true }
    }
    assert.equal(location.pathname, '/chatgpt/consent')
    const signed = location.searchParams.toString()
    await load('src/lib/chatgpt/query.ts').validateSignedQuery(signed)
    const consent = await call('consent', { accept, oauth_query: signed })
    assert.equal(consent.status, 200)
    const value = await consent.json(), target = new URL(value.url ?? value.redirect_uri)
    assert.ok(load('src/lib/chatgpt/redirect.ts').allowedConnectionRedirect(target.href, signed, origin))
    assert.equal(target.searchParams.get('state'), fields.state)
    assert.equal(target.searchParams.get('iss'), origin + '/api/auth')
    return { response, verifier, code: target.searchParams.get('code'), error: target.searchParams.get('error'), clientId, callback: fields.redirect_uri }
  }
  function exchange(grant, overrides = {}) { return call('token', { client_id: grant.clientId, grant_type: 'authorization_code',
    code: grant.code, code_verifier: grant.verifier, redirect_uri: grant.callback, resource, ...overrides }) }
  const mcp = load('src/app/mcp/route.ts')
  async function tool(token, name = 'tools/list', args = {}) {
    const response = await mcp.POST(new Request(origin + '/mcp', { method: 'POST', headers: {
      Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: name === 'tools/list' ? name : 'tools/call',
        params: name === 'tools/list' ? {} : { name, arguments: args } }) }))
    return { response, value: await response.json() }
  }
  return { load, auth, provider, store, counters, call, register, authorize, exchange, tool, userId: signup.user.id,
    disable: () => { active = false } }
}

function dataClient(owner) {
  const expenseId = '00000000-0000-4000-8000-000000000043'
  const actor = { id: owner, organization_id: null, account_type: 'freelancer', role: 'MEMBER', is_active: true }
  const tables = { users: [actor], expenses: [{ id: expenseId, user_id: owner, amount: 23.5, currency: 'USD',
    expense_date: '2026-10-02', status: 'DRAFT', archived_at: null, category: 'OFFICE_SUPPLIES',
    receipt_path: null, receipt_url: null, description: 'UNTRUSTED CONTENT' }] }
  return { auth: { getUser: async () => ({ data: { user: { id: owner } }, error: null }) }, from(table) {
    const filters = [], q = { select() { return q }, eq(k, v) { filters.push(row => row[k] === v); return q },
      is(k, v) { filters.push(row => row[k] === v); return q }, neq(k, v) { filters.push(row => row[k] !== v); return q },
      in(k, v) { filters.push(row => v.includes(row[k])); return q }, gte(k, v) { filters.push(row => row[k] >= v); return q },
      lt(k, v) { filters.push(row => row[k] < v); return q }, lte(k, v) { filters.push(row => row[k] <= v); return q }, order() { return q },
      single: async () => ({ data: (tables[table] ?? []).find(row => filters.every(filter => filter(row))), error: null }),
      range: async (start, end) => ({ data: (tables[table] ?? []).filter(row => filters.every(filter => filter(row))).slice(start, end + 1), error: null }) }
    return q
  } }
}

test('DCR is opt-in; disabled registration and unknown client CRUD stay inaccessible', async () => {
  const h = await harness(false)
  assert.equal((await h.call('register', metadata)).status, 404)
  assert.equal(h.load('src/lib/chatgpt/config.ts').allowedOAuthClientId('amt_dcr_' + 'a'.repeat(43)), false)
  assert.equal((await h.call('create-client', metadata)).status, 404)
  const discovery = await h.load('src/app/.well-known/oauth-authorization-server/api/auth/route.ts').GET(new Request(origin + '/.well-known/oauth-authorization-server/api/auth'))
  const value = await discovery.json()
  assert.equal(value.registration_endpoint, undefined)
  assert.equal(value.client_id_metadata_document_supported, undefined)
})

test('DCR creates a bounded public client; invalid metadata cannot create clients or remote fetches', async () => {
  const h = await harness()
  const discovery = await h.load('src/app/.well-known/oauth-authorization-server/api/auth/route.ts').GET(new Request(origin + '/.well-known/oauth-authorization-server/api/auth'))
  const value = await discovery.json()
  assert.equal(value.registration_endpoint, origin + '/api/auth/oauth2/register')
  assert.equal(value.client_id_metadata_document_supported, undefined)
  for (const changes of [
    { redirect_uris: ['https://evil.example/callback'] }, { redirect_uris: ['http://192.168.1.1:4321/callback'] },
    { redirect_uris: [callback + '?next=evil'] }, { redirect_uris: [callback + '#x'] },
    { redirect_uris: ['https://chatgpt.com/path/../connector_platform_oauth_redirect'] },
    { token_endpoint_auth_method: 'client_secret_post' }, { scope: 'amountly:write' },
    { grant_types: ['client_credentials'] }, { resources: [origin + '/admin'] }, { skip_consent: true },
    { require_pkce: false }, { jwks_uri: 'http://127.0.0.1/private' }, { metadata: { admin: true } },
  ]) {
    h.counters.delete('oauth:register')
    assert.equal((await h.call('register', { ...metadata, ...changes })).status, 400)
  }
  assert.equal(h.store.oauthClient.length, 0)
  h.counters.delete('oauth:register')
  const id = await h.register()
  const stored = h.store.oauthClient.find(row => row.clientId === id)
  assert.notEqual(stored.requirePKCE, false) // undefined is the provider's mandatory-PKCE default.
  assert.notEqual(stored.skipConsent, true)
  assert.ok(!stored.clientSecret)
  assert.ok(stored.scopes.every(scope => ['amountly:read', 'offline_access', 'email'].includes(scope)))
  assert.equal((await h.call('register', metadata, { raw: JSON.stringify({ ...metadata, client_name: 'x'.repeat(4096) }) })).status, 413)
})

test('registration rate, credentials, origin, content type and input boundaries are enforced', async () => {
  const h = await harness()
  for (const headers of [{ Cookie: 'synthetic-cookie' }, { Authorization: 'Bearer synthetic' }])
    assert.equal((await h.call('register', metadata, { headers })).status, 400)
  assert.equal((await h.call('register', metadata, { headers: { Origin: 'https://evil.example' } })).status, 403)
  assert.equal((await h.call('register', metadata, { headers: { 'Content-Type': 'text/plain' } })).status, 415)
  assert.equal((await h.call('register', {}, { raw: '{' })).status, 400)
  h.counters.delete('oauth:register')
  for (let i = 0; i < 10; i++) await h.register()
  const limited = await h.call('register', metadata, { headers: { 'X-Forwarded-For': '203.0.113.99' } })
  assert.equal(limited.status, 429)
  assert.equal(limited.headers.get('Retry-After'), '60')
  assert.equal(h.store.oauthClient.length, 10)
})

test('real provider rejects unregistered IDs, callback substitution, wrong scope/resource and missing S256', async () => {
  const h = await harness(), id = await h.register()
  const unknown = await h.authorize('amt_dcr_' + 'a'.repeat(43))
  assert.ok(unknown.rejected || [400, 401].includes(unknown.response.status))
  for (const changes of [{ redirect_uri: callback + '/other' }, { redirect_uri: 'https://evil.example/callback' },
    { scope: 'amountly:write' }, { resource: origin + '/admin' }, { code_challenge_method: 'plain' }, { code_challenge: '' }])
  {
    const result = await h.authorize(id, changes)
    assert.ok(result.rejected || [400, 401].includes(result.response.status))
  }
  assert.equal(h.store.oauthAccessToken.length, 0)
  const denied = await h.authorize(id, {}, false)
  assert.equal(denied.error, 'access_denied'); assert.equal(denied.code, null)
})

test('DCR consent, PKCE, five tools and token lifecycle work', async () => {
  const h = await harness(), id = await h.register(), other = await h.register()
  const wrong = await h.authorize(id)
  assert.ok([400, 401].includes((await h.exchange(wrong, { code_verifier: randomBytes(32).toString('base64url') })).status))
  const bound = await h.authorize(id)
  assert.ok([400, 401].includes((await h.exchange(bound, { client_id: other })).status))
  const grant = await h.authorize(id), issued = await h.exchange(grant)
  assert.equal(issued.status, 200)
  const tokens = await issued.json()
  assert.equal(tokens.expires_in, 600)
  const claims = await getOAuthProviderApi({ context: await h.auth.$context }, h.provider.options)
    .requireActiveAccessToken(tokens.access_token, id)
  assert.equal(claims.sub, h.userId)
  assert.ok(h.store.oauthAccessToken.every(row => /^[a-f0-9]{64}$/.test(row.token)))
  const listed = await h.tool(tokens.access_token)
  assert.equal(listed.response.status, 200)
  assert.equal(listed.value.result.tools.length, 5)
  const period = { start: '2026-10-01', end: '2026-10-03', currency: 'USD' }
  for (const [name, args] of [['get_financial_review', period], ['summarize_expenses', period],
    ['list_unpaid_invoices', { currency: 'USD' }], ['list_upcoming_bills', { currency: 'USD' }],
    ['get_financial_record', { kind: 'expenses', id: '00000000-0000-4000-8000-000000000043' }]]) {
    const result = await h.tool(tokens.access_token, name, args)
    assert.equal(result.response.status, 200)
    assert.equal(result.value.result.isError, undefined, name)
    assert.ok(!JSON.stringify(result.value).includes('UNTRUSTED CONTENT'))
    if (name === 'get_financial_review') assert.equal(result.value.result.structuredContent.totals.expenses, 23.5)
  }
  const foreign = await h.tool(tokens.access_token, 'get_financial_record', { kind: 'expenses', id: '00000000-0000-4000-8000-000000000099' })
  assert.equal(foreign.value.result.isError, true)
  assert.ok([400, 401].includes((await h.exchange(grant)).status))
  assert.equal((await h.tool(tokens.access_token)).response.status, 401, 'code replay revokes the family')
  const fresh = await h.authorize(id), freshIssued = await h.exchange(fresh)
  assert.equal(freshIssued.status, 200)
  const freshTokens = await freshIssued.json()
  const refreshed = await h.call('token', { client_id: id, grant_type: 'refresh_token', refresh_token: freshTokens.refresh_token, resource })
  assert.equal(refreshed.status, 200)
  const rotated = await refreshed.json()
  assert.ok(rotated.refresh_token !== freshTokens.refresh_token)
  assert.equal((await h.tool(rotated.access_token)).response.status, 200)
  assert.ok([400, 401].includes((await h.call('token', { client_id: other, grant_type: 'refresh_token', refresh_token: rotated.refresh_token, resource })).status))
  assert.equal((await h.tool(rotated.access_token)).response.status, 200, 'client substitution does not revoke another client')
  assert.ok([400, 401].includes((await h.call('token', { client_id: id, grant_type: 'refresh_token', refresh_token: freshTokens.refresh_token, resource })).status))
  assert.equal((await h.tool(rotated.access_token)).response.status, 401, 'refresh replay revokes the family')
  const revocationGrant = await h.authorize(id), revocationIssued = await h.exchange(revocationGrant)
  assert.equal(revocationIssued.status, 200)
  const revocationTokens = await revocationIssued.json()
  assert.equal((await h.call('revoke', { client_id: other, token: revocationTokens.refresh_token })).status, 200)
  assert.equal((await h.tool(revocationTokens.access_token)).response.status, 200, 'a different client cannot revoke this grant')
  h.disable()
  assert.equal((await h.tool(revocationTokens.access_token)).response.status, 401)
  assert.equal((await h.call('revoke', { client_id: id, token: revocationTokens.refresh_token })).status, 200)
  assert.ok([400, 401].includes((await h.call('token', { client_id: id, grant_type: 'refresh_token', refresh_token: revocationTokens.refresh_token, resource })).status))
})


test('DCR is the sole registration path and old URL clients cannot authorize, refresh or revoke', async () => {
  const h = await harness()
  const value = await (await h.load('src/app/.well-known/oauth-authorization-server/api/auth/route.ts').GET(new Request(origin))).json()
  assert.equal(value.client_id_metadata_document_supported, undefined)
  assert.equal(value.token_endpoint_auth_signing_alg_values_supported, undefined)
  assert.equal(value.revocation_endpoint_auth_signing_alg_values_supported, undefined)
  assert.deepEqual(value.token_endpoint_auth_methods_supported, ['none'])
  assert.deepEqual(value.revocation_endpoint_auth_methods_supported, ['none'])
  assert.equal(value.registration_endpoint, origin + '/api/auth/oauth2/register')
  for (const client_id of ['https://chatgpt.com/oauth/client.json', 'https://chatgpt.com/oauth/codex/client.json']) {
    assert.equal(h.load('src/lib/chatgpt/config.ts').allowedOAuthClientId(client_id), false)
    assert.equal((await h.authorize(client_id)).response.status, 400)
    assert.equal((await h.call('token', { client_id, grant_type: 'refresh_token', refresh_token: 'amt_rt_synthetic' })).status, 400)
    assert.equal((await h.call('revoke', { client_id, token: 'amt_rt_synthetic' })).status, 400)
  }
  const id = await h.register()
  for (const field of ['client_assertion', 'client_assertion_type', 'client_secret'])
    assert.equal((await h.call('token', { client_id: id, grant_type: 'refresh_token', refresh_token: 'amt_rt_synthetic', [field]: 'unsupported' })).status, 400)
})

test('native DCR metadata rejects arbitrary hosts, aliases, mixed callbacks and privilege fields', async () => {
  const h = await harness()
  const native = { ...metadata, client_name: 'Codex', application_type: 'native', redirect_uris: ['http://127.0.0.1:4321/callback'] }
  for (const uri of ['http://127.1:4321/callback', 'http://2130706433:4321/callback', 'http://0x7f000001:4321/callback',
    'http://[::1]:4321/callback', 'http://localhost.evil.example:4321/callback', 'http://192.168.1.1:4321/callback',
    'https://127.0.0.1:4321/callback', 'http://user@localhost:4321/callback', 'http://localhost:0/callback',
    'http://localhost:65536/callback', 'http://localhost:4321/path/../callback', 'http://localhost:4321/callback?x=1',
    'http://localhost:4321/callback#x', 'http://LOCALHOST:4321/callback', 'http://localhost:04321/callback',
    'http://localhost:4321/other']) {
    h.counters.delete('oauth:register')
    assert.equal((await h.call('register', { ...native, redirect_uris: [uri] })).status, 400, uri)
  }
  for (const change of [{ redirect_uris: [callback] }, { application_type: 'web' },
    { redirect_uris: [native.redirect_uris[0], callback] }, { token_endpoint_auth_method: 'private_key_jwt' },
    { require_pkce: false }, { skip_consent: true }]) {
    h.counters.delete('oauth:register')
    assert.equal((await h.call('register', { ...native, ...change })).status, 400)
  }
  assert.equal(h.store.oauthClient.length, 0)
})

test('native DCR supports loopback port selection while binding issued codes to their actual callback', async () => {
  const h = await harness()
  for (const uri of ['http://127.0.0.1:64903/callback', 'http://localhost:5421/callback', 'http://127.0.0.1:4321/callback/synthetic-id']) {
    const clientId = await h.register({ ...metadata, client_name: 'Codex', redirect_uris: [uri] })
    assert.equal(h.store.oauthClient.find(row => row.clientId === clientId).applicationType, 'native')
    const changed = new URL(uri); changed.port = '5432'
    const selectedPort = await h.authorize(clientId, { redirect_uri: changed.href })
    assert.ok(selectedPort.code, 'RFC 8252 permits choosing the listener port at authorization')
    assert.ok([400, 401].includes((await h.exchange(selectedPort, { redirect_uri: uri })).status), 'code binds the actual authorization callback port')
    for (const invalid of [uri.replace('/callback', '/other'), uri.includes('127.0.0.1') ? uri.replace('127.0.0.1', 'localhost') : uri.replace('localhost', '127.0.0.1')]) {
      const wrong = await h.authorize(clientId, { redirect_uri: invalid })
      assert.ok(wrong.rejected || [400, 401].includes(wrong.response.status), 'native callback host and path remain bound')
    }
    const grant = await h.authorize(clientId, { redirect_uri: uri })
    assert.ok([400, 401].includes((await h.exchange(grant, { redirect_uri: changed.href })).status))
    const fresh = await h.authorize(clientId, { redirect_uri: uri })
    const issued = await h.exchange(fresh); assert.equal(issued.status, 200)
    const tokens = await issued.json()
    assert.equal((await h.tool(tokens.access_token)).response.status, 200)
    const refreshed = await h.call('token', { client_id: clientId, grant_type: 'refresh_token', refresh_token: tokens.refresh_token, resource })
    assert.equal(refreshed.status, 200)
    const rotated = await refreshed.json()
    assert.equal((await h.call('revoke', { client_id: clientId, token: rotated.refresh_token })).status, 200)
    assert.equal((await h.tool(rotated.access_token)).response.status, 401)
  }
})


test('consent labels do not mistake self-registered native clients for verified OpenAI apps', async () => {
  const h = await harness(), label = h.load('src/lib/chatgpt/redirect.ts').connectionClientLabel
  assert.equal(label(new URLSearchParams({ client_id: 'amt_dcr_' + 'a'.repeat(43), redirect_uri: 'http://127.0.0.1:4321/callback' }).toString()), 'your native MCP client')
  assert.equal(label(new URLSearchParams({ client_id: 'amt_dcr_' + 'a'.repeat(43), redirect_uri: callback }).toString()), 'ChatGPT')
})

test('disconnect revokes all and only the signed-in owner capabilities, including refresh-only families', async () => {
  const owner = '00000000-0000-4000-8000-000000000001', foreign = '00000000-0000-4000-8000-000000000002'
  const rows = { oauthAccessToken: [{ userId: owner }, { userId: foreign }],
    oauthRefreshToken: [{ userId: owner }, { userId: owner }, { userId: foreign }],
    oauthConsent: [{ userId: owner }, { userId: foreign }], mcp_grants: [{ userId: owner }, { userId: foreign }] }
  let released = false
  const connection = { release() { released = true }, async query(sql, values) {
    if (['begin', 'commit', 'rollback'].includes(sql)) return { rows: [] }
    assert.deepEqual(Array.from(values), [owner], 'every mutation is scoped to the authenticated owner')
    assert.match(sql, /where (?:user_id|"userId")=\$1/)
    const table = Object.keys(rows).find(name => sql.includes(name))
    assert.ok(table)
    for (const row of rows[table]) if (row.userId === owner) row.revoked = true
    return { rows: [] }
  } }
  const load = loadApp({ '@/lib/platform/auth': { authPool: () => ({ connect: async () => connection }) },
    '@/lib/platform/server': { validateOrigin: () => {}, requireIdentity: async () => ({ id: owner }) },
    '@/lib/chatgpt/auth': { privateHeaders: {}, mcpAuthError: error => { throw error } },
  }, { NEXT_PUBLIC_BACKEND: 'render', AMOUNTLY_CHATGPT: 'enabled' })
  const response = await load('src/app/api/chatgpt/disconnect/route.ts').POST(new Request(origin + '/api/chatgpt/disconnect', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))
  assert.equal(response.status, 200)
  assert.equal(released, true)
  for (const table of Object.values(rows)) for (const row of table) assert.equal(!!row.revoked, row.userId === owner)
})
