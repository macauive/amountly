const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Compile actual application modules; replace only network/client dependencies.
// No application secrets, provider traffic or persistent database writes.
function harness(options = {}) {
  const calls = { provider: 0, quota: 0, auth: 0 }
  const cache = new Map()
  const syntheticUser = '00000000-0000-4000-8000-000000000001'
  const supabase = {
    auth: { getUser: async () => {
      calls.auth++
      return options.invalidToken ? { data: {}, error: new Error('private auth details') } : { data: { user: { id: syntheticUser } }, error: null }
    } },
    from: () => ({ select: () => ({ eq: (field, id) => {
      assert.equal(field, 'id'); assert.equal(id, syntheticUser)
      return { single: async () => ({ data: { is_active: options.active !== false }, error: null }) }
    } }) }),
    rpc: async name => {
      assert.equal(name, 'consume_ai_quota'); calls.quota++
      return { data: options.quota !== false, error: options.quotaError ? new Error('private database details') : null }
    },
  }
  const load = file => {
    file = path.resolve(file)
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }; cache.set(file, module)
    const localRequire = name => {
      if (name === '@/lib/ai/client' && options.captureClient) return { runAiTask: options.captureClient }
      if (name === '@supabase/supabase-js') return { createClient: () => supabase }
      if (name === 'next/server') return { NextResponse: { json: (value, init) => Response.json(value, init) } }
      if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`)
      return require(name)
    }
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
      module, exports: module.exports, require: localRequire, console, Request, Response,
      TextDecoder, Uint8Array, URL, AbortSignal,
      process: { env: {
        NEXT_PUBLIC_SUPABASE_URL: 'https://auth.example.invalid',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-test-key',
        OPENAI_API_KEY: 'synthetic-local-test-key',
      } },
      fetch: async (_url, init) => {
        calls.provider++
        const input = JSON.parse(init.body)
        assert.equal(input.store, false)
        assert.equal(input.max_output_tokens, 4000)
        assert.ok(init.signal)
        if (options.providerFailure) return new Response('private provider details', { status: 500 })
        return Response.json(options.response ?? {
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ description: 'Example', quantity: 1, rate: 5, amount: 5, reason: 'Example' }) }] }],
        })
      },
    }, { filename: file })
    return module.exports
  }
  return { load, calls }
}

function request(body = { task: 'invoice_line', payload: 'One example at 5' }, headers = {}) {
  return new Request('https://example.invalid/api/ai', {
    method: 'POST', headers: {
      'content-type': 'application/json', authorization: 'Bearer synthetic_test_token_000000000000', ...headers,
    }, body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

test('AI denies anonymous, invalid, cross-origin and inactive callers before paid work', async () => {
  for (const [options, headers, expected] of [
    [{}, { authorization: '' }, 401],
    [{ invalidToken: true }, {}, 401],
    [{}, { origin: 'https://other.example.invalid' }, 403],
    [{ active: false }, {}, 403],
  ]) {
    const h = harness(options)
    const response = await h.load('src/app/api/ai/route.ts').POST(request(undefined, headers))
    assert.equal(response.status, expected)
    assert.equal(h.calls.provider, 0); assert.equal(h.calls.quota, 0)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
})

test('AI rejects malformed, oversized, unexpected and prototype task input before quota/provider', async () => {
  for (const [body, expected] of [
    ['{', 400], [{ task: 'invoice_line' }, 400],
    [{ task: 'constructor', payload: 'example' }, 400],
    [{ task: 'toString', payload: 'example' }, 400],
    [{ task: 'invoice_line', payload: 'example', unexpected: true }, 400],
    [{ task: 'invoice_line', payload: 'a'.repeat(65000) }, 413],
  ]) {
    const h = harness()
    assert.equal((await h.load('src/app/api/ai/route.ts').POST(request(body))).status, expected)
    assert.equal(h.calls.provider, 0); assert.equal(h.calls.quota, 0)
  }
})

test('AI quota is fail-closed for exhaustion and database failures', async () => {
  for (const [options, expected] of [[{ quota: false }, 429], [{ quotaError: true }, 503]]) {
    const h = harness(options)
    const response = await h.load('src/app/api/ai/route.ts').POST(request())
    assert.equal(response.status, expected)
    assert.equal(h.calls.provider, 0); assert.equal(h.calls.quota, 1)
    assert.ok(!(await response.text()).includes('private'))
  }
})

test('AI parses raw HTTP output after verified identity and quota', async () => {
  const h = harness()
  const response = await h.load('src/app/api/ai/route.ts').POST(request())
  assert.equal(response.status, 200)
  assert.equal((await response.json()).result.amount, 5)
  assert.equal(h.calls.auth, 1); assert.equal(h.calls.quota, 1); assert.equal(h.calls.provider, 1)
})

test('provider failures, refusals and incomplete responses do not leak details', async () => {
  for (const options of [
    { providerFailure: true },
    { response: { status: 'incomplete', output: [] } },
    { response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private reason' }] }] } },
  ]) {
    const h = harness(options)
    const response = await h.load('src/app/api/ai/route.ts').POST(request())
    assert.equal(response.status, 502)
    assert.ok(!(await response.text()).includes('private'))
  }
})

test('AI output rejects executable/external links and invalid financial values', () => {
  const { schemas } = harness().load('src/lib/ai/contracts.ts')
  for (const href of ['javascript:alert(1)', '//other.example.invalid', 'https://other.example.invalid', '/settings', '/invoices?next=evil']) {
    assert.equal(schemas.dashboard_insights.safeParse({
      nextSteps: [{ id: 'example', title: 'Example', detail: '', href, priority: 'low' }],
      monthlySummary: { headline: '', body: '', highlights: [] }, searchResults: [],
    }).success, false)
  }
  for (const rate of [-1, Infinity, NaN, 1e12]) {
    assert.equal(schemas.invoice_line.safeParse({ description: '', quantity: 1, rate, amount: 1, reason: '' }).success, false)
  }
  assert.equal(schemas.invoice_line.safeParse({ description: '', quantity: 2, rate: 5, amount: 999, reason: '' }).success, false)
  assert.equal(schemas.time_entry.safeParse({ date: '2026-02-30', start_time: '25:00', end_time: '12:00', notes: '', duration_minutes: 1, reason: '' }).success, false)
})

test('dashboard sends only permitted summary fields, never receipt credentials or nested records', async () => {
  let payload
  const h = harness({ captureClient: async (_task, input) => { payload = input; return {} } })
  const expense = {
    id: '00000000-0000-4000-8000-000000000001', merchant: 'Example', amount: 5,
    expense_date: '2026-09-09', status: 'DRAFT', category: 'OTHER',
    receipt_url: 'https://storage.example.invalid/receipt?token=synthetic',
    user_id: 'synthetic-owner', project: { private_field: 'not-for-ai' },
  }
  await h.load('src/lib/dashboard-ai.ts').getDashboardAiInsights({
    accountType: 'personal', searchQuery: '', candidateHrefs: ['/expenses'], bills: [], expenses: [expense],
    workData: { invoices: [], expenses: [], timeEntries: [], vendorBills: [] },
  })
  const serialized = JSON.stringify(payload)
  assert.ok(!serialized.includes('receipt_url'))
  assert.ok(!serialized.includes('synthetic-owner'))
  assert.ok(!serialized.includes('not-for-ai'))
  const { payloadSchemas } = h.load('src/lib/ai/contracts.ts')
  assert.equal(payloadSchemas.dashboard_insights.safeParse(payload).success, true)
  payload.expenses[0].receipt_url = expense.receipt_url
  assert.equal(payloadSchemas.dashboard_insights.safeParse(payload).success, false)
})

test('both CSV exporters use a shared formula-safe encoder', () => {
  const { escapeCsvValue } = harness().load('src/lib/csv.ts')
  for (const value of ['=1+1', '+1', '-1', '@SUM(A1)', ' \t=1', '\r\n=1', '\ufeff=1', '\u0000=1']) {
    assert.ok(escapeCsvValue(value).startsWith('"\''))
  }
  assert.equal(escapeCsvValue(-1), '"-1"')
  assert.equal(escapeCsvValue('a,"b\nc'), '"a,""b\nc"')
  assert.equal(escapeCsvValue(null), '""')
  for (const file of ['settings', 'tax']) {
    const code = fs.readFileSync(`src/app/(dashboard)/${file}/page.tsx`, 'utf8')
    assert.ok(code.includes("import { escapeCsvValue } from '@/lib/csv'"))
  }
})

test('byte limit applies to streamed UTF-8 bodies without a Content-Length', async () => {
  const { readBoundedJson } = harness().load('src/lib/http.ts')
  const message = new Response(JSON.stringify({ text: 'é'.repeat(50) }))
  await assert.rejects(readBoundedJson(message, 80), error => error.status === 413)
})
