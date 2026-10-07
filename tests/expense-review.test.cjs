const test = require('node:test')
const assert = require('node:assert/strict')
const loadApp = require('./load-app.cjs')

const expenseId = '00000000-0000-4000-8000-000000001300'
const version = '2026-10-07T16:00:00.123456+00:00'

function service(error = null) {
  const calls = []
  const api = loadApp({ '@/lib/supabase': { getSupabaseClient: () => ({
    rpc: async (name, args) => { calls.push({ name, args }); return { error } },
  }) } })('src/services/review.service.ts')
  return { api, calls }
}

test('solo review service sends only the requested marker and exact observed version', async () => {
  const { api, calls } = service()
  await api.setExpenseReview(expenseId, true, version)
  await api.setExpenseReview(expenseId, false, version)
  assert.equal(calls.length, 2)
  for (const [index, call] of calls.entries()) {
    assert.equal(call.name, 'set_expense_review')
    assert.equal(JSON.stringify(call.args), JSON.stringify({ p_id: expenseId, p_reviewed: index === 0, p_expected_updated_at: version }))
    assert.equal('reviewed_at' in call.args, false)
    assert.equal('p_owner_id' in call.args, false)
  }
})

test('solo review service rejects malformed IDs, flags and versions before RPC', async () => {
  const { api, calls } = service()
  for (const args of [
    ['bad', true, version], [null, true, version], [expenseId, 'true', version],
    [expenseId, null, version], [expenseId, true, null], [expenseId, true, ''],
    [expenseId, true, '2026-10-07'], [expenseId, true, 'bad'],
    [expenseId, true, '2026-10-07T16:00:00.1234567Z'], [expenseId, true, 'x'.repeat(65)],
  ]) await assert.rejects(api.setExpenseReview(...args), error => error instanceof api.RecordSaveError && error.outcome === 'rejected')
  assert.equal(calls.length, 0)
})

test('solo review failures preserve conflict, denied and unknown outcomes without leaking details', async () => {
  for (const [code, outcome, message] of [
    ['PT409', 'rejected', /Reload and review/], ['42501', 'rejected', /permission/],
    ['22023', 'rejected', /fields and current status/], ['CONNECTION_FAILED', 'unknown', /Could not confirm/],
  ]) {
    const { api } = service({ code, message: 'private database details', details: 'private record values' })
    await assert.rejects(api.setExpenseReview(expenseId, true, version), error => {
      assert.ok(error instanceof api.RecordSaveError)
      assert.equal(error.outcome, outcome)
      assert.match(error.message, message)
      assert.doesNotMatch(error.message, /private/)
      return true
    })
  }
})

function dataRoute() {
  const calls = { upstream: [], identity: 0 }
  class BoundaryError extends Error { constructor(status, message) { super(message); this.status = status } }
  const originalFetch = global.fetch
  global.fetch = async (url, options) => {
    calls.upstream.push({ url, options })
    return Response.json(null)
  }
  try {
    const api = loadApp({
      '@/lib/platform/config': { usesRenderBackend: true },
      '@/lib/ai/server': { AiHttpError: BoundaryError },
      '@/lib/platform/server': {
        privateDataOrigin: 'http://127.0.0.1:1', identityToken: async () => 'synthetic-server-identity',
        requireIdentity: async headers => {
          calls.identity++
          if (headers.get('authorization') !== 'Bearer synthetic-session') throw new BoundaryError(401, 'Unauthenticated')
          return { userId: expenseId }
        },
        validateOrigin: headers => {
          if (headers.get('origin') !== 'https://example.invalid') throw new BoundaryError(403, 'Invalid origin')
        },
      },
    })('src/app/api/data/[...path]/route.ts')
    return { api, calls }
  } finally { global.fetch = originalFetch }
}

function request(method = 'POST', extraHeaders = {}) {
  return new Request('https://example.invalid/api/data/rpc/set_expense_review', {
    method, headers: { origin: 'https://example.invalid', authorization: 'Bearer synthetic-session', 'content-type': 'application/json', ...extraHeaders },
    ...(method === 'POST' ? { body: JSON.stringify({ p_id: expenseId, p_reviewed: true, p_expected_updated_at: version }) } : {}),
  })
}
const context = { params: Promise.resolve({ path: ['rpc', 'set_expense_review'] }) }

test('Render proxy permits solo review only through authenticated same-origin POST', async () => {
  const { api, calls } = dataRoute()
  for (const [method, headers, status] of [
    ['GET', {}, 405], ['PATCH', {}, 405], ['POST', { origin: 'https://other.invalid' }, 403],
    ['POST', { authorization: '' }, 401], ['POST', { 'content-type': 'text/plain' }, 415],
  ]) assert.equal((await api[method](request(method, headers), context)).status, status)
  assert.equal(calls.upstream.length, 0)
  const response = await api.POST(request('POST', { 'accept-profile': 'amountly_private', 'content-profile': 'amountly_private', 'x-user-id': 'synthetic-other' }), context)
  assert.equal(response.status, 200)
  assert.equal(calls.upstream.length, 1)
  const { url, options } = calls.upstream[0]
  assert.equal(url, 'http://127.0.0.1:1/rpc/set_expense_review')
  assert.equal(options.headers.get('authorization'), 'Bearer synthetic-server-identity')
  assert.equal(options.headers.get('accept-profile'), null)
  assert.equal(options.headers.get('content-profile'), null)
  assert.equal(options.headers.get('x-user-id'), null)
  assert.equal(options.headers.get('cookie'), null)
  assert.equal(JSON.parse(options.body).p_expected_updated_at, version)
})
