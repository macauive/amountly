const test = require('node:test')
const assert = require('node:assert/strict')
const { Buffer } = require('node:buffer')
const loadApp = require('./load-app.cjs')

const routePath = 'src/app/api/ai/receipt/route.ts'
const appOrigin = 'https://app.example.invalid'
const ownUser = '00000000-0000-4000-8000-000000000001'
const maxBytes = 10 * 1024 * 1024
const rawImage = Buffer.from('synthetic image input')
const normalizedImage = Buffer.from('normalized image input')
const rawPdf = Buffer.from('%PDF-1.7\nsynthetic receipt input\n%%EOF')
const validResult = {
  document_type: 'receipt', amount: '12.50', currency: 'USD', merchant: 'Demo Shop',
  description: 'Paper', expense_date: '2026-10-07', category: 'OFFICE_SUPPLIES',
  confidence: 'high', reason: 'Synthetic fixture', summary: 'Paper purchase',
}
const completed = result => ({ status: 'completed', output: [
  { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] },
] })

// Execute the actual route, auth, HTTP reader and output contracts. Only external
// clients and the separately tested file decoder are replaced. No live AI or writes.
function harness(t, options = {}) {
  const calls = { auth: 0, profiles: 0, validation: 0, quota: 0, provider: 0, writes: 0, payloads: [] }
  const db = {
    auth: { getUser: async () => {
      calls.auth++
      return options.anonymous || options.invalidToken
        ? { data: {}, error: new Error('private auth detail') }
        : { data: { user: { id: ownUser } }, error: null }
    } },
    from: table => {
      assert.equal(table, 'users', 'Receipt extraction must not access financial tables')
      return { select: fields => {
        assert.equal(fields, 'is_active')
        return { eq: (field, id) => {
          assert.equal(field, 'id'); assert.equal(id, ownUser)
          return { single: async () => {
            calls.profiles++
            return { data: { is_active: options.active !== false }, error: null }
          } }
        } }
      }, insert: () => { calls.writes++; throw new Error('Unexpected financial write') },
      update: () => { calls.writes++; throw new Error('Unexpected financial write') },
      upsert: () => { calls.writes++; throw new Error('Unexpected financial write') },
      delete: () => { calls.writes++; throw new Error('Unexpected financial write') } }
    },
    rpc: async (name, args) => {
      assert.equal(name, 'consume_ai_quota')
      assert.ok(args === undefined || Object.keys(args).length === 0, 'Quota uses authenticated ownership')
      calls.quota++
      return { data: Object.hasOwn(options, 'quota') ? options.quota : true,
        error: options.quotaError ? new Error('private database detail') : null }
    },
    storage: { from: () => { calls.writes++; throw new Error('Extraction must not persist uploads') } },
  }
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses')
    assert.equal(init.method, 'POST')
    assert.ok(init.signal)
    assert.equal(init.headers.Authorization, 'Bearer synthetic-local-test-key')
    const payload = JSON.parse(init.body)
    calls.provider++; calls.payloads.push(payload)
    if (options.providerHandler) return options.providerHandler(payload, init)
    if (options.providerFailure) return new Response('private provider detail', { status: 500 })
    if (options.providerThrows) throw new Error('private network detail')
    if (options.rawProviderBody !== undefined) return new Response(options.rawProviderBody)
    return Response.json(options.response ?? completed(options.result ?? validResult))
  })
  let load
  const overrides = {
    'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
    '@supabase/supabase-js': { createClient: () => db },
    '@/lib/ai/receipt-file': { validateReceiptFile: async (bytes, mime) => {
      calls.validation++
      assert.ok(Buffer.isBuffer(bytes))
      if (options.validationHandler) return options.validationHandler(bytes, mime)
      if (options.validationError) {
        const { AiHttpError } = load('src/lib/ai/server.ts')
        throw new AiHttpError(400, 'Invalid receipt file')
      }
      if (options.validationThrows) throw new Error('private decoder detail')
      return mime === 'application/pdf' ? { data: bytes, mime }
        : { data: normalizedImage, mime: 'image/jpeg' }
    } },
    '@/lib/platform/auth': {
      getAuth: () => ({ api: { getSession: async ({ query }) => {
        calls.auth++
        assert.equal(query.disableCookieCache, true)
        if (options.anonymous || options.invalidToken) return null
        return { user: { id: ownUser, email: 'qa@example.invalid', emailVerified: true,
          disabled: options.disabled === true } }
      } } }),
      authPool: () => ({ query: async (sql, params) => {
        calls.profiles++
        assert.equal(sql, 'select is_active from public.users where id=$1')
        assert.deepEqual(Array.from(params), [ownUser])
        return { rows: [{ is_active: options.active !== false }] }
      } }),
    },
    '@/lib/platform/config': {
      appOrigin: () => appOrigin,
      requiredSecret: () => 'synthetic-signing-material-only-0000000000',
    },
    '@supabase/postgrest-js': { PostgrestClient: class { constructor() { return db } } },
    jose: { SignJWT: class {
      setProtectedHeader() { return this }
      setSubject(id) { assert.equal(id, ownUser); return this }
      setIssuedAt() { return this }
      setExpirationTime() { return this }
      async sign() { return 'synthetic-server-scoped-token' }
    } },
  }
  load = loadApp(overrides, {
    NODE_ENV: 'production', NEXT_PUBLIC_BACKEND: options.backend ?? 'supabase',
    NEXT_PUBLIC_SUPABASE_URL: 'https://auth.example.invalid',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-test-key',
    OPENAI_API_KEY: 'synthetic-local-test-key', AMOUNTLY_APP_ORIGIN: appOrigin,
  })
  return { calls, load, restore: () => fetchMock.mock.restore() }
}

function request(body = rawImage, headers = {}, query = '', signal) {
  return new Request(`${appOrigin}/api/ai/receipt${query}`, {
    method: 'POST', headers: {
      'content-type': 'image/png', authorization: 'Bearer synthetic_test_token_000000000000',
      origin: appOrigin, ...headers,
    }, body, signal,
  })
}
async function denied(h, input, status, expected = {}) {
  const response = await h.load(routePath).POST(input)
  assert.equal(response.status, status)
  assert.match(response.headers.get('cache-control'), /(?:^|,\s*)no-store(?:,|$)/)
  assert.equal(h.calls.provider, expected.provider ?? 0)
  assert.equal(h.calls.quota, expected.quota ?? 0)
  assert.equal(h.calls.writes, 0)
  const text = await response.text()
  assert.ok(!text.includes('private'), 'Internal errors must not be returned')
  assert.ok(!text.includes('synthetic'), 'Submitted data and identities must not be returned on failure')
  return response
}
async function settleUntil(predicate) {
  for (let turn = 0; turn < 100 && !predicate(); turn++) {
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.ok(predicate(), 'Expected asynchronous endpoint stage was reached')
}

test('receipt endpoint denies anonymous, invalid, inactive and cross-origin callers before decoding or paid work', async t => {
  for (const backend of ['supabase', 'render']) {
    for (const [options, headers, status] of [
      [{ anonymous: true }, { authorization: '' }, 401],
      [{ invalidToken: true }, {}, 401],
      [{ active: false }, {}, 403],
      [{}, { origin: 'https://evil.example.invalid', 'x-forwarded-host': 'evil.example.invalid' }, 403],
    ]) {
      const h = harness(t, { backend, ...options })
      await denied(h, request(undefined, headers), status)
      assert.equal(h.calls.validation, 0)
      h.restore()
    }
  }
  const disabled = harness(t, { backend: 'render', disabled: true })
  await denied(disabled, request(), 401)
  assert.equal(disabled.calls.validation, 0)
})

test('receipt endpoint rejects unsupported MIME and client ownership/path/file metadata before decoding or quota', async t => {
  for (const [type, body] of [
    ['application/json', JSON.stringify({ user_id: 'synthetic-foreign-user', filename: 'private-name.pdf', file: 'data' })],
    ['multipart/form-data; boundary=synthetic', '--synthetic\r\nforeign ownership and file data'],
    ['application/octet-stream', rawImage], ['image/svg+xml', '<svg/>'], ['text/plain', 'receipt'],
    ['image/gif', rawImage], ['image/heic', rawImage], ['', rawImage],
  ]) {
    const h = harness(t)
    await denied(h, request(body, { 'content-type': type }), 415)
    assert.equal(h.calls.validation, 0)
    h.restore()
  }
  for (const query of ['?user_id=synthetic-foreign-user', '?filename=private-name.pdf', '?path=../../private']) {
    const h = harness(t)
    await denied(h, request(undefined, {}, query), 400)
    assert.equal(h.calls.validation, 0)
    h.restore()
  }
})

test('receipt endpoint enforces declared and actual streamed 10 MiB limits before decoding or quota', async t => {
  for (const [body, headers] of [
    [rawImage, { 'content-length': String(maxBytes + 1) }],
    [rawImage, { 'content-length': 'invalid' }],
    [Buffer.alloc(maxBytes + 1), {}],
    [Buffer.alloc(maxBytes + 1), { 'content-length': '1' }],
  ]) {
    const h = harness(t)
    await denied(h, request(body, headers), 413)
    assert.equal(h.calls.validation, 0)
    h.restore()
  }
})

test('empty and malformed receipts fail before quota and unexpected decoder errors stay private', async t => {
  const empty = harness(t)
  await denied(empty, request(Buffer.alloc(0)), 400)
  empty.restore()
  const malformed = harness(t, { validationError: true })
  await denied(malformed, request(Buffer.from('malformed synthetic input')), 400)
  assert.equal(malformed.calls.validation, 1)
  malformed.restore()
  const crashed = harness(t, { validationThrows: true })
  await denied(crashed, request(), 502)
  assert.equal(crashed.calls.validation, 1)
})

test('durable receipt quota denies exhaustion, uncertain results and database failures before provider traffic', async t => {
  for (const [options, status] of [
    [{ quota: false }, 429], [{ quota: null }, 429], [{ quota: undefined }, 429],
    [{ quota: 'true' }, 429], [{ quotaError: true }, 503],
  ]) {
    const h = harness(t, options)
    await denied(h, request(), status, { quota: 1 })
    assert.equal(h.calls.validation, 1)
    h.restore()
  }
})

test('all accepted image MIME types send normalized image data with strict, bounded, non-stored Responses requests', async t => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
    const h = harness(t)
    const response = await h.load(routePath).POST(request(undefined, {
      'content-type': type, 'x-user-id': 'synthetic-foreign-user', 'x-filename': 'private-name.png',
      'content-disposition': 'attachment; filename="private-name.png"',
    }))
    assert.equal(response.status, 200)
    assert.match(response.headers.get('cache-control'), /(?:^|,\s*)no-store(?:,|$)/)
    assert.deepEqual(await response.json(), { result: validResult })
    assert.equal(h.calls.auth, 1); assert.equal(h.calls.validation, 1)
    assert.equal(h.calls.quota, 1); assert.equal(h.calls.provider, 1); assert.equal(h.calls.writes, 0)
    const payload = h.calls.payloads[0]
    assert.equal(payload.store, false)
    assert.equal(payload.max_output_tokens, 2000)
    assert.equal(payload.tools, undefined)
    assert.equal(payload.text.format.type, 'json_schema')
    assert.equal(payload.text.format.strict, true)
    assert.equal(payload.text.format.schema.additionalProperties, false)
    assert.match(payload.instructions, /untrusted/i)
    assert.match(payload.instructions, /never.{0,60}instructions/i)
    assert.match(payload.instructions, /(?:do not|never).{0,80}(?:infer|invent|guess)/i)
    const parts = payload.input.flatMap(item => item.content ?? [])
    const image = parts.filter(part => part.type === 'input_image')
    assert.equal(image.length, 1)
    assert.equal(image[0].image_url, `data:image/jpeg;base64,${normalizedImage.toString('base64')}`)
    assert.equal(parts.some(part => part.type === 'input_file'), false)
    assert.ok(!JSON.stringify(payload).includes('private-name'))
    assert.ok(!JSON.stringify(payload).includes('synthetic-foreign-user'))
    h.restore()
  }
})

test('PDF receipts send validated bytes under a constant safe filename and cannot write financial records', async t => {
  const h = harness(t, { backend: 'render' })
  const response = await h.load(routePath).POST(request(rawPdf, {
    'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="private-name.pdf"',
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { result: validResult })
  assert.equal(h.calls.profiles, 1); assert.equal(h.calls.writes, 0)
  const parts = h.calls.payloads[0].input.flatMap(item => item.content ?? [])
  const pdf = parts.filter(part => part.type === 'input_file')
  assert.equal(pdf.length, 1)
  assert.equal(pdf[0].filename, 'receipt.pdf')
  assert.equal(pdf[0].file_data, `data:application/pdf;base64,${rawPdf.toString('base64')}`)
  assert.equal(parts.some(part => part.type === 'input_image'), false)
  assert.ok(!JSON.stringify(h.calls.payloads[0]).includes('private-name'))
})

test('receipt provider failures, refusals, incomplete output and oversized or malformed HTTP output stay private', async t => {
  for (const options of [
    { providerFailure: true }, { providerThrows: true }, { rawProviderBody: '{private provider detail' },
    { rawProviderBody: 'private provider detail'.repeat(8000) },
    { response: { status: 'incomplete', output: [], incomplete_details: { reason: 'private reason' } } },
    { response: { status: 'completed', output: [
      { type: 'message', content: [{ type: 'refusal', refusal: 'private reason' }] },
    ] } },
    { response: { status: 'completed', output: [
      { type: 'message', content: [{ type: 'output_text', text: '{private result detail' }] },
    ] } },
  ]) {
    const h = harness(t, options)
    await denied(h, request(), 502, { quota: 1, provider: 1 })
    h.restore()
  }
})

test('receipt output rejects malformed money, unsupported currency, invalid dates and unexpected ownership fields', async t => {
  for (const patch of [
    { amount: '$12.50' }, { amount: '12.50 USD' }, { amount: '-12.50' }, { amount: '1e3' },
    { amount: '1,200.00' }, { amount: ' 12.50 ' }, { amount: '12.501' }, { amount: '123456789.00' },
    { amount: 12.5 }, { currency: 'usd' }, { currency: 'JPY' }, { currency: null },
    { expense_date: '2026-02-30' }, { expense_date: '10/07/2026' },
    { document_type: 'bank_statement' }, { category: 'invented-category' }, { confidence: 'certain' },
    { user_id: 'synthetic-foreign-user' }, { receipt_path: '../private' }, { notes: 'private extra field' },
  ]) {
    const h = harness(t, { result: { ...validResult, ...patch } })
    await denied(h, request(), 502, { quota: 1, provider: 1 })
    h.restore()
  }
})

test('missing amount, date and currency remain empty rather than receiving fabricated values', async t => {
  const result = { ...validResult, amount: '', currency: '', expense_date: '', confidence: 'low' }
  const h = harness(t, { result })
  const response = await h.load(routePath).POST(request())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { result })
  assert.equal(h.calls.writes, 0)
})

test('sensitive text in provider fields is independently redacted before returning a draft', async t => {
  const result = { ...validResult, merchant: 'Demo qa@example.invalid',
    description: 'Contact 202-555-0100', reason: 'Address 123 Example Street',
    summary: 'Card 4242 4242 4242 4242' }
  const h = harness(t, { result })
  const response = await h.load(routePath).POST(request())
  assert.equal(response.status, 200)
  const returned = await response.json()
  for (const sensitive of ['qa@example.invalid', '202-555-0100', '123 Example Street', '4242 4242 4242 4242']) {
    assert.ok(!JSON.stringify(returned).includes(sensitive))
  }
  for (const field of ['merchant', 'description', 'reason', 'summary']) {
    assert.match(returned.result[field], /\[REDACTED_/)
  }
  assert.equal(returned.result.amount, '12.50')
  assert.equal(h.calls.writes, 0)
})

test('receipt concurrency gate rejects a third in-flight extraction and releases slots after completion or error', async t => {
  const releases = []
  const h = harness(t, { providerHandler: async () => {
    if (releases.length < 2) return new Promise(resolve => releases.push(resolve))
    return Response.json(completed(validResult))
  } })
  const { POST } = h.load(routePath)
  const pending = [POST(request()), POST(request())]
  await settleUntil(() => releases.length === 2)
  await denied(h, request(), 429, { provider: 2, quota: 2 })
  assert.equal(h.calls.validation, 2)
  releases.forEach(release => release(Response.json(completed(validResult))))
  const responses = await Promise.all(pending)
  assert.deepEqual(responses.map(response => response.status), [200, 200])
  assert.equal((await POST(request())).status, 200)
  h.restore()

  const failed = harness(t, { providerFailure: true })
  const failedPost = failed.load(routePath).POST
  for (let attempt = 0; attempt < 3; attempt++) assert.equal((await failedPost(request())).status, 502)
  assert.equal(failed.calls.provider, 3)
  assert.equal(failed.calls.writes, 0)
})

test('a stalled receipt upload times out before decoding, releases its slot and cancels the body reader', async t => {
  const realSetTimeout = globalThis.setTimeout
  let expire, cancelled = false
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (delay === 10000) {
      expire = callback
      return realSetTimeout(() => {}, 0)
    }
    return realSetTimeout(callback, delay, ...args)
  })
  const h = harness(t)
  const { POST } = h.load(routePath)
  const pending = POST(new Request(`${appOrigin}/api/ai/receipt`, {
    method: 'POST', headers: { 'content-type': 'image/png', origin: appOrigin,
      authorization: 'Bearer synthetic_test_token_000000000000' },
    body: new ReadableStream({ cancel() { cancelled = true } }), duplex: 'half',
  }))
  await settleUntil(() => typeof expire === 'function')
  expire()
  const response = await pending
  assert.equal(response.status, 408)
  assert.equal(cancelled, true)
  assert.equal(h.calls.validation, 0); assert.equal(h.calls.quota, 0); assert.equal(h.calls.provider, 0)
  assert.equal((await POST(request())).status, 200)
  assert.equal(h.calls.writes, 0)
})

test('an already-cancelled receipt does not read, decode, consume quota or contact the provider', async t => {
  const controller = new AbortController()
  controller.abort()
  const h = harness(t)
  const input = request(undefined, {}, '', controller.signal)
  await denied(h, input, 408)
  assert.equal(input.body.locked, false)
  assert.equal(h.calls.validation, 0)
  assert.equal((await h.load(routePath).POST(request())).status, 200)
})

test('cancelling an in-flight receipt upload cancels and unlocks its reader before decoding or quota', async t => {
  const controller = new AbortController()
  let cancelled = false
  const input = new Request(`${appOrigin}/api/ai/receipt`, {
    method: 'POST', headers: { 'content-type': 'image/png', origin: appOrigin,
      authorization: 'Bearer synthetic_test_token_000000000000' },
    body: new ReadableStream({
      start(stream) { stream.enqueue(Buffer.from('partial synthetic input')) },
      cancel() { cancelled = true },
    }), duplex: 'half', signal: controller.signal,
  })
  const h = harness(t)
  const { POST } = h.load(routePath)
  const pending = POST(input)
  await settleUntil(() => input.body.locked)
  controller.abort()
  const response = await pending
  assert.equal(response.status, 408)
  assert.equal(cancelled, true)
  assert.equal(input.body.locked, false)
  assert.equal(h.calls.validation, 0); assert.equal(h.calls.quota, 0); assert.equal(h.calls.provider, 0)
  assert.equal(h.calls.writes, 0)
  assert.equal((await POST(request())).status, 200)
})

test('cancellation while decoding prevents subsequent quota consumption and provider calls', async t => {
  const controller = new AbortController()
  let completeValidation, validations = 0
  const h = harness(t, { validationHandler: async () => {
    validations++
    if (validations > 1) return { data: normalizedImage, mime: 'image/jpeg' }
    return new Promise(resolve => { completeValidation = resolve })
  } })
  const { POST } = h.load(routePath)
  const pending = POST(request(undefined, {}, '', controller.signal))
  await settleUntil(() => typeof completeValidation === 'function')
  controller.abort()
  completeValidation({ data: normalizedImage, mime: 'image/jpeg' })
  const response = await pending
  assert.equal(response.status, 408)
  assert.equal(h.calls.validation, 1)
  assert.equal(h.calls.quota, 0); assert.equal(h.calls.provider, 0); assert.equal(h.calls.writes, 0)
  assert.equal((await POST(request())).status, 200)
})
