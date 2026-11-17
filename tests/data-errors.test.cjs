const test = require('node:test')
const assert = require('node:assert/strict')
const loadApp = require('./load-app.cjs')

test('trigger, RLS, unique and invalid-column rejections have the same public status and body', async t => {
  const origin = 'https://app.example.invalid'
  const errors = [['P0001', 400], ['42501', 403], ['23505', 409], ['42703', 400]]
  t.mock.method(globalThis, 'fetch', async () => {
    const [code, status] = errors.shift()
    return Response.json({ code, details: 'private', message: 'internal_constraint_name' },
      { status, headers: { 'Content-Range': '0-0/1' } })
  })
  const load = loadApp({ '@/lib/platform/server': {
    identityToken: async () => '', privateDataOrigin: 'http://127.0.0.1:3001',
    requireIdentity: async () => ({ id: 'synthetic' }), validateOrigin: () => {},
  } }, { NEXT_PUBLIC_BACKEND: 'render' })
  const { POST } = load('src/app/api/data/[...path]/route.ts')
  while (errors.length) {
    const response = await POST(new Request(origin + '/api/data/tax_filings', {
      method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', Origin: origin },
    }), { params: Promise.resolve({ path: ['tax_filings'] }) })
    assert.equal(response.status, 400)
    assert.equal(response.headers.get('Content-Range'), null)
    assert.deepEqual(await response.json(), { code: 'REQUEST_REJECTED',
      message: 'Could not complete this request.', details: null, hint: null })
  }
})
