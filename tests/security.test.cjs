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
        NODE_ENV: options.nodeEnv ?? 'production',
      } },
      fetch: async (_url, init) => {
        calls.provider++
        const input = JSON.parse(init.body)
        options.inspectProviderInput?.(input)
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

test('AI loopback origin compatibility is development-only, same-port, and ignores spoofed hosts', async () => {
  for (const [nodeEnv, url, origin, expected] of [
    ['development', 'http://localhost:4174/api/ai', 'http://127.0.0.1:4174', 401],
    ['development', 'http://localhost:4174/api/ai', 'http://[::1]:4174', 401],
    ['production', 'http://localhost:4174/api/ai', 'http://127.0.0.1:4174', 403],
    ['development', 'http://localhost:4174/api/ai', 'http://127.0.0.1:9999', 403],
    ['development', 'http://localhost:4174/api/ai', 'https://127.0.0.1:4174', 403],
    ['development', 'http://localhost:4174/api/ai', 'http://evil.invalid:4174', 403],
    ['development', 'https://example.invalid/api/ai', 'http://127.0.0.1:4174', 403],
    ['development', 'http://localhost:4174/api/ai', 'http://127.0.0.1:4174/path', 403],
    ['development', 'http://localhost:4174/api/ai', 'null', 403],
    ['production', 'https://example.invalid/api/ai', 'https://example.invalid', 401],
  ]) {
    const h = harness({ nodeEnv, invalidToken: true })
    const response = await h.load('src/app/api/ai/route.ts').POST(new Request(url, {
      method: 'POST', headers: { origin, authorization: 'Bearer synthetic_test_token_000000000000',
        host: origin, 'x-forwarded-host': origin, 'content-type': 'application/json' }, body: '{}',
    }))
    assert.equal(response.status, expected, `${nodeEnv}: ${origin}`)
    assert.equal(h.calls.auth, expected === 401 ? 1 : 0)
    assert.equal(h.calls.provider, 0); assert.equal(h.calls.quota, 0)
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

test('capture schemas constrain monetary strings and still reject malformed provider amounts', async () => {
  for (const task of ['expense_capture', 'receipt_capture']) {
    for (const amount of ['42.50', '', '42.50 USD', '$42.50', '-42.50']) {
      const expected = ['42.50', ''].includes(amount) ? 200 : 502
      const result = { amount, merchant: 'Demo', description: 'Paper', expense_date: '2026-09-28',
        category: 'OFFICE_SUPPLIES', confidence: 'high', reason: 'Synthetic fixture',
        ...(task === 'receipt_capture' ? { notes: '', summary: 'Paper' } : {}) }
      const h = harness({
        inspectProviderInput: input => {
          const pattern = new RegExp(input.text.format.schema.properties.amount.pattern)
          assert.equal(pattern.test(amount), expected === 200)
          assert.equal(input.text.format.strict, true)
        },
        response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] },
      })
      assert.equal((await h.load('src/app/api/ai/route.ts').POST(request({ task, payload: 'Demo paper for 42.50 USD' }))).status, expected)
    }
  }
})

test('contact capture keeps personal data redacted at the provider and restores returned placeholders', async () => {
  const result = { name: 'Demo', contact_name: '', email: '[REDACTED_EMAIL_0]', phone: '', address: '',
    city: '', state: '', zip_code: '', notes: '', reason: '' }
  const h = harness({
    inspectProviderInput: input => {
      const providerText = input.input[0].content[0].text
      assert.ok(providerText.includes('[REDACTED_EMAIL_0]'))
      assert.ok(!providerText.includes('demo@example.com'))
      assert.deepEqual(input.text.format.schema.properties.email.enum, ['[REDACTED_EMAIL_0]'])
      assert.match(input.instructions, /placeholder exactly into its corresponding field/)
    },
    response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] },
  })
  const response = await h.load('src/app/api/ai/route.ts').POST(request({ task: 'contact_capture', payload: 'Demo demo@example.com' }))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.result.email, 'demo@example.com')
  assert.equal(body.safety.redacted, true)
})

test('contact capture rejects altered references, invented addresses and dropped unambiguous emails', async () => {
  for (const email of ['<redacted>', '[REDACTED_EMAIL_99]', 'invented@example.com', '']) {
    const result = { name: 'Demo', contact_name: '', email, phone: '', address: '', city: '', state: '', zip_code: '', notes: '', reason: '' }
    const h = harness({ response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] } })
    const response = await h.load('src/app/api/ai/route.ts').POST(request({ task: 'contact_capture', payload: 'Demo demo@example.com' }))
    assert.equal(response.status, 502)
    assert.ok(!(await response.text()).includes(email || 'demo@example.com'))
  }
})

test('contact references preserve ambiguity and restore only a selected source value', async () => {
  for (const [email, expected] of [['[REDACTED_EMAIL_1]', 'second@example.com'], ['', '']]) {
    const result = { name: 'Demo', contact_name: '', email, phone: '', address: '', city: '', state: '', zip_code: '', notes: '', reason: '' }
    const h = harness({
      inspectProviderInput: input => assert.deepEqual(input.text.format.schema.properties.email.enum, ['', '[REDACTED_EMAIL_0]', '[REDACTED_EMAIL_1]']),
      response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] },
    })
    const response = await h.load('src/app/api/ai/route.ts').POST(request({ task: 'contact_capture', payload: 'Demo first@example.com or second@example.com' }))
    assert.equal(response.status, 200)
    assert.equal((await response.json()).result.email, expected)
  }
  const safety = harness().load('src/lib/ai/safety.ts')
  const repeated = safety.redactPersonalData('Demo demo@example.com; repeat demo@example.com')
  assert.equal(safety.contactEmailReferences(repeated.replacements).includes(''), false)
  assert.deepEqual(Array.from(safety.contactEmailReferences({})), [''])
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


test('invoice records preserve issued states, partial balances, currency and issued client snapshot', () => {
  const { load } = harness()
  const { mapInvoice, normalizeInvoiceStatus } = load('src/lib/invoice-records.ts')
  for (const state of ['DRAFT','SENT','PAID','OVERDUE','CANCELLED']) {
    assert.equal(normalizeInvoiceStatus(state),state)
    assert.equal(normalizeInvoiceStatus(state.toLowerCase()),state)
  }
  const invoice = mapInvoice({ id:'synthetic',status:'SENT',total:300,currency:'EUR',due_date:'2099-01-01',
    client:{name:'Changed name',city:'Changed city'},issued_snapshot:{client:{name:'Original name'}},
    payments:[{amount:'100.00'}] })
  assert.equal(invoice.status,'SENT')
  assert.equal(invoice.balance_due,200)
  assert.equal(invoice.amount_paid,100)
  assert.equal(invoice.currency,'EUR')
  assert.equal(invoice.client.name,'Original name')
  assert.equal(invoice.client.city,undefined)
  assert.equal(mapInvoice({status:'SENT',total:100,due_date:'2000-01-01'}).status,'OVERDUE')
  assert.equal(mapInvoice({status:'PAID',total:100}).balance_due,0)
  assert.equal(mapInvoice({status:'CANCELLED',total:100}).balance_due,0)
  assert.throws(() => normalizeInvoiceStatus('unexpected'))
})
