const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const loadApp = require('./load-app.cjs')

const route = 'src/pages/api/reports/accountant.ts'
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ownerId = uuid(1)
const appOrigin = 'https://amountly.example.invalid'
const storageOrigin = 'https://synthetic-project.supabase.invalid'
const query = { year: '2026', month: '4', currency: 'USD', basis: 'cash', start: '2026-10-01', end: '2026-10-31' }
const profile = { account_type: 'freelancer', role: 'MEMBER', is_active: true, organization_id: null }
const identity = { id: ownerId, email: 'synthetic-owner@example.invalid' }
const completed = { bytes: Buffer.from('synthetic archive bytes'), filename: 'amountly-accountant-2026-10-01-2026-10-31-USD.zip' }
const privateDetail = 'synthetic-private-context'

// Exercise the actual handler, query parser, capability rules and platform
// origin/session checks. Report reads, storage and ZIP generation are replaced
// here; the real report loader and ZIP library have separate focused tests.
function harness(options = {}) {
  const calls = { clients: 0, sessions: 0, activeReads: 0, auth: 0, profiles: [], reports: [], readers: [], builds: [] }
  const at = (values, index, fallback) => values ? values[Math.min(index, values.length - 1)] : fallback
  const client = {
    auth: { getUser: async () => {
      const value = at(options.auth, calls.auth++, { data: { user: identity }, error: null })
      return value
    } },
    from: table => {
      assert.equal(table, 'users', 'The route must not mutate financial records or storage')
      const call = { table, fields: null, filters: [] }
      const builder = {
        select(fields) { call.fields = fields; return builder },
        eq(field, value) { call.filters.push([field, value]); return builder },
        async maybeSingle() {
          const value = at(options.profiles, calls.profiles.length, { data: profile, error: null })
          calls.profiles.push(call)
          return value
        },
      }
      return builder
    },
  }
  const packet = loadApp()('src/lib/accountant-packet.ts')
  class ReportLimitError extends Error {}
  const overrides = {
    '@supabase/ssr': {
      createServerClient: (url, key, config) => {
        calls.clients++
        assert.equal(url, storageOrigin)
        assert.equal(key, 'synthetic-public-key')
        assert.equal(config.cookies.getAll()[0].name, 'synthetic-cookie')
        return client
      },
      serializeCookieHeader: () => 'synthetic-cookie=value',
    },
    '@/lib/platform/auth': {
      getAuth: () => ({ api: { getSession: async ({ query }) => {
        assert.equal(query.disableCookieCache, true, 'Revoked sessions must bypass the cookie cache')
        const session = at(options.sessions, calls.sessions++, { user: { ...identity, emailVerified: true, disabled: false } })
        return session
      } } }),
      authPool: () => ({ query: async (sql, params) => {
        assert.equal(sql, 'select is_active from public.users where id=$1')
        assert.equal(params.length, 1)
        assert.match(params[0], /^[0-9a-f-]{36}$/)
        const active = at(options.active, calls.activeReads++, true)
        return { rows: [{ is_active: active }] }
      } }),
    },
    '@/lib/platform/config': { appOrigin: () => appOrigin, requiredSecret: () => 'synthetic-signing-material-only-0000000000' },
    '@supabase/postgrest-js': { PostgrestClient: class {
      constructor(url, config) {
        assert.equal(url, 'http://127.0.0.1:3001')
        assert.equal(config.headers.Authorization, 'Bearer synthetic-scoped-token')
        calls.clients++
        return client
      }
    } },
    jose: { SignJWT: class {
      setProtectedHeader() { return this }
      setSubject(id) { assert.equal(id, ownerId); return this }
      setIssuedAt() { return this }
      setExpirationTime() { return this }
      async sign() { return 'synthetic-scoped-token' }
    } },
    '@/lib/workspace-report': {
      ReportLimitError,
      loadWorkspaceReport: async (db, filters, scope) => {
        assert.equal(db, client)
        calls.reports.push({ filters, scope })
        if (options.reportFailure) throw options.reportFailure === 'limit' ? new ReportLimitError(privateDetail) : new Error(privateDetail)
        return { rows: [], expenses: [], period: scope.period }
      },
    },
    '@/lib/receipt-export': {
      withReceiptReader: async (actor, db, deadline, operation) => {
        assert.equal(db, client)
        assert.equal(actor.id, ownerId)
        assert.equal(actor.email, identity.email)
        assert.ok(Number.isFinite(deadline))
        calls.readers.push({ actor, deadline })
        if (options.readerFailure) throw new Error(privateDetail)
        return operation(async () => { throw new Error('The stub ZIP builder must not read an original') })
      },
    },
    '@/lib/accountant-packet': {
      ...packet,
      buildAccountantPacket: async (report, reader, config) => {
        assert.equal(typeof reader, 'function')
        calls.builds.push({ report, config })
        if (options.buildFailure) throw typeof options.buildFailure === 'function' ? options.buildFailure(packet) : options.buildFailure
        return options.build ? options.build(report) : completed
      },
    },
  }
  const load = loadApp(overrides, { NEXT_PUBLIC_BACKEND: options.backend ?? 'supabase',
    NEXT_PUBLIC_SUPABASE_URL: storageOrigin, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-key' })
  const handler = load(route).default
  async function request(patch = {}, responseOptions = {}) {
    const response = Object.assign(new EventEmitter(), { headers: {}, headersSent: false, writableFinished: false, destroyed: false, jsonCalls: 0,
      setHeader(key, value) { this.headers[key] = value }, removeHeader(key) { delete this.headers[key] },
      status(code) { this.code = code; return this },
      json(body) { this.jsonCalls++; this.body = body; this.headersSent = true; this.writableFinished = true; this.emit('finish'); return this },
      send(body) {
        if (responseOptions.throwOnSend === 'before') throw new Error(privateDetail)
        this.body = body; this.headersSent = true
        if (responseOptions.throwOnSend === 'after') throw new Error(privateDetail)
        responseOptions.onSend?.(this)
        if (!responseOptions.hold) { this.writableFinished = true; this.emit('finish') }
        return this
      },
      destroy() { this.destroyed = true; this.emit('close'); return this },
    })
    await handler({ method: 'GET', query, cookies: { 'synthetic-cookie': 'synthetic-value' },
      headers: { origin: appOrigin }, aborted: false, ...patch }, response)
    assert.equal(response.headers['Cache-Control'], 'private, no-store')
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff')
    assert.equal(response.headers['Content-Security-Policy'], "default-src 'none'; sandbox")
    if (response.code !== 200) {
      assert.equal(response.headers['Content-Disposition'], undefined, 'Failures never attach a partial packet')
      assert.equal(response.headers['Content-Type'], undefined, 'Failures never advertise a ZIP')
      assert.ok(!Buffer.isBuffer(response.body))
      const text = JSON.stringify(response.body)
      for (const hidden of [privateDetail, ownerId, identity.email, storageOrigin, 'synthetic-scoped-token']) assert.ok(!text.includes(hidden))
    }
    return response
  }
  return { request, calls, packet }
}

test('accountant route rejects methods and untrusted query fields before creating a client', async () => {
  const h = harness()
  const wrongMethod = await h.request({ method: 'POST' })
  assert.equal(wrongMethod.code, 405)
  assert.equal(wrongMethod.headers.Allow, 'GET')
  for (const patch of [{ start: '2026-02-30' }, { end: '2027-04-01' }, { start: ['2026-10-01', '2026-10-02'] },
    { basis: 'other' }, { user_id: uuid(2) }, { ownerId: uuid(2) }, { organization_id: uuid(3) }, { path: '../../receipt.pdf' }, { filename: 'private.zip' }]) {
    assert.equal((await h.request({ query: { ...query, ...patch } })).code, 400)
  }
  assert.equal(h.calls.clients, 0)
  assert.equal(h.calls.sessions, 0)
  assert.equal(h.calls.reports.length, 0)
})

test('accountant route enforces origin checks while permitting a same-site cookie GET without an Origin header', async () => {
  for (const backend of ['supabase', 'render']) {
    const h = harness({ backend })
    for (const headers of [{ origin: 'https://foreign.example.invalid' }, { 'sec-fetch-site': 'cross-site' },
      { origin: 'https://foreign.example.invalid', 'x-forwarded-host': 'amountly.example.invalid' }]) {
      assert.equal((await h.request({ headers })).code, 403)
    }
    assert.equal(h.calls.clients, 0)
    assert.equal(h.calls.reports.length, 0)
    assert.equal((await h.request({ headers: { 'sec-fetch-site': 'same-origin' } })).code, 200)
  }
})

test('accountant route denies anonymous, inactive and non-standalone freelancer accounts before report or receipt reads', async () => {
  const anonymous = harness({ auth: [{ data: { user: null }, error: { message: privateDetail } }] })
  assert.equal((await anonymous.request()).code, 401)
  assert.equal(anonymous.calls.profiles.length, 0)
  for (const bad of [null, { ...profile, account_type: 'personal' }, { ...profile, account_type: 'business', role: 'OWNER' },
    { ...profile, is_active: false }, { ...profile, organization_id: uuid(3) }, { ...profile, role: 'UNKNOWN' },
    { account_type: 'freelancer', role: 'MEMBER', is_active: true }]) {
    for (const backend of ['supabase', 'render']) {
      const h = harness({ backend, profiles: [{ data: bad, error: null }] })
      assert.equal((await h.request()).code, 403)
      assert.equal(h.calls.reports.length, 0)
      assert.equal(h.calls.readers.length, 0)
      assert.ok(h.calls.profiles.every(call => call.filters.some(([field, id]) => field === 'id' && id === ownerId)))
    }
  }
  for (const user of [null, { ...identity, emailVerified: false }, { ...identity, emailVerified: true, disabled: true }]) {
    const h = harness({ backend: 'render', sessions: [user ? { user } : null] })
    assert.equal((await h.request()).code, 401)
    assert.equal(h.calls.clients, 0)
    assert.equal(h.calls.reports.length, 0)
  }
})

test('accountant route binds the report and original reader to the authenticated owner and selected subperiod', async () => {
  for (const backend of ['supabase', 'render']) {
    const h = harness({ backend })
    const response = await h.request()
    assert.equal(response.code, 200)
    assert.equal(response.headers['Content-Type'], 'application/zip')
    assert.equal(response.headers['Content-Disposition'], `attachment; filename="${completed.filename}"`)
    assert.deepEqual(response.body, completed.bytes)
    assert.equal(h.calls.reports.length, 1)
    const { filters, scope } = h.calls.reports[0]
    assert.deepEqual(JSON.parse(JSON.stringify(filters)), { ...query, year: 2026, month: 4 })
    assert.equal(scope.ownerId, ownerId)
    assert.deepEqual(JSON.parse(JSON.stringify(scope.period)), { start: query.start, end: query.end, endExclusive: '2026-11-01' })
    assert.ok(scope.deadline > Date.now())
    assert.equal(h.calls.readers.length, 1)
    assert.equal(h.calls.builds[0].report.ownerId, ownerId)
    assert.equal(h.calls.builds[0].report.currency, query.currency)
    assert.equal(h.calls.builds[0].report.basis, query.basis)
    assert.equal(h.calls.builds[0].config.storageOrigin, storageOrigin)
    assert.equal(h.calls.profiles.length, 2, 'The current profile is checked again after building the ZIP')
    if (backend === 'render') assert.equal(h.calls.sessions, 2, 'The Render session is refreshed before disclosure')
    else assert.equal(h.calls.auth, 2)
  }
})

test('session revocation or account changes during export prevent archive disclosure', async () => {
  for (const final of [{ data: { user: null }, error: null }, { data: { user: { id: uuid(2) } }, error: null }]) {
    const h = harness({ auth: [{ data: { user: identity }, error: null }, final] })
    assert.equal((await h.request()).code, 401)
    assert.equal(h.calls.builds.length, 1)
  }
  for (const final of [null, { user: { ...identity, id: uuid(2), emailVerified: true } },
    { user: { ...identity, emailVerified: true, disabled: true } }]) {
    const h = harness({ backend: 'render', sessions: [{ user: { ...identity, emailVerified: true } }, final] })
    assert.equal((await h.request()).code, 401)
    assert.equal(h.calls.builds.length, 1)
  }
  const disabled = harness({ backend: 'render', active: [true, false] })
  assert.equal((await disabled.request()).code, 403)
  for (const backend of ['supabase', 'render']) {
    for (const changed of [{ ...profile, is_active: false }, { ...profile, organization_id: uuid(3) }, { ...profile, account_type: 'business' }]) {
      const h = harness({ backend, profiles: [{ data: profile, error: null }, { data: changed, error: null }] })
      assert.equal((await h.request()).code, 403)
      assert.equal(h.calls.builds.length, 1)
    }
  }
})

test('reader failures, malformed output and limits return safe errors without a partial ZIP', async () => {
  for (const [options, status] of [[{ reportFailure: true }, 503], [{ reportFailure: 'limit' }, 413],
    [{ readerFailure: true }, 503], [{ buildFailure: packet => new packet.PacketIntegrityError(privateDetail) }, 422],
    [{ buildFailure: packet => new packet.PacketLimitError(privateDetail) }, 413], [{ buildFailure: new Error(privateDetail) }, 503],
    [{ profiles: [{ data: null, error: { message: privateDetail } }] }, 503]]) {
    assert.equal((await harness(options).request()).code, status)
  }
  const aborted = harness()
  assert.equal((await aborted.request({ aborted: true })).code, 503)
  assert.equal(aborted.calls.builds.length, 1)
})

test('a pending packet blocks a second build and releases its process slot on both success and failure', async () => {
  for (const fail of [false, true]) {
    let enter, release
    const entered = new Promise(resolve => { enter = resolve })
    const gate = new Promise(resolve => { release = resolve })
    let builds = 0
    const h = harness({ build: async () => {
      if (builds++ === 0) { enter(); await gate; if (fail) throw new Error(privateDetail) }
      return completed
    } })
    const pending = h.request()
    await entered
    const busy = await h.request()
    assert.equal(busy.code, 429)
    assert.equal(busy.headers['Retry-After'], '5')
    assert.equal(h.calls.reports.length, 1)
    assert.equal(h.calls.builds.length, 1)
    release()
    assert.equal((await pending).code, fail ? 503 : 200)
    assert.equal((await h.request()).code, 200)
    assert.equal(h.calls.builds.length, 2)
  }
})

test('a queued ZIP keeps the process slot until the response finishes or closes', async () => {
  for (const event of ['finish', 'close']) {
    const h = harness()
    let sent, response
    const queued = new Promise(resolve => { sent = resolve })
    const pending = h.request({}, { hold: true, onSend: value => { response = value; sent() } })
    await queued
    try {
      assert.equal(response.headersSent, true)
      assert.equal(response.writableFinished, false)
      assert.equal(response.listenerCount('finish'), 1)
      assert.equal(response.listenerCount('close'), 1)
      const busy = await h.request()
      assert.equal(busy.code, 429)
      assert.equal(h.calls.builds.length, 1)
    } finally {
      if (event === 'finish') response.writableFinished = true
      else response.destroyed = true
      response.emit(event)
      await pending
    }
    assert.equal(response.listenerCount('finish'), 0)
    assert.equal(response.listenerCount('close'), 0)
    assert.equal((await h.request()).code, 200)
    assert.equal(h.calls.builds.length, 2)
  }
})

test('a stalled response is destroyed after the bounded deadline without writing a second response', async t => {
  const timers = [], cleared = []
  t.mock.method(globalThis, 'setTimeout', (callback, milliseconds) => {
    assert.equal(milliseconds, 30000)
    const timer = { callback, milliseconds }
    timers.push(timer)
    return timer
  })
  t.mock.method(globalThis, 'clearTimeout', timer => { cleared.push(timer) })
  const h = harness()
  let sent, response
  const queued = new Promise(resolve => { sent = resolve })
  const pending = h.request({}, { hold: true, onSend: value => { response = value; sent() } })
  await queued
  assert.equal((await h.request()).code, 429)
  assert.equal(timers.length, 1)
  timers[0].callback()
  await pending
  assert.equal(response.destroyed, true)
  assert.equal(response.jsonCalls, 0)
  assert.equal(response.listenerCount('finish'), 0)
  assert.equal(response.listenerCount('close'), 0)
  assert.ok(cleared.includes(timers[0]))
  assert.equal((await h.request()).code, 200)
})

test('synchronous send failures clean up the response wait and never append JSON to a sent archive', async () => {
  for (const stage of ['before', 'after']) {
    const h = harness()
    const response = await h.request({}, { throwOnSend: stage })
    assert.equal(response.code, stage === 'before' ? 503 : 200)
    assert.equal(response.listenerCount('finish'), 0)
    assert.equal(response.listenerCount('close'), 0)
    if (stage === 'before') {
      assert.equal(response.jsonCalls, 1)
      assert.equal(response.headers['Content-Disposition'], undefined)
    } else {
      assert.equal(response.jsonCalls, 0)
      assert.equal(response.destroyed, true)
    }
    assert.equal((await h.request()).code, 200)
  }
})
