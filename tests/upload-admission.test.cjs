const test = require('node:test')
const assert = require('node:assert/strict')
const loadApp = require('./load-app.cjs')

for (const endpoint of [
  { route: 'src/app/api/receipts/[...path]/route.ts', path: 'receipts/upload', type: 'image/png' },
  { route: 'src/app/api/capture-drafts/route.ts', path: 'capture-drafts', type: 'multipart/form-data; boundary=test' },
]) test(`${endpoint.path} bounds buffering by authenticated user`, async () => {
  const blocked = []
  let reads = 0
  class AiHttpError extends Error {
    constructor(status) { super('Synthetic cancelled upload'); this.status = status }
  }
  const load = loadApp({
    '@/lib/ai/server': { AiHttpError },
    '@/lib/ai/receipt-file': { validateReceiptFile() { assert.fail('Cancelled upload must never enter the decoder') } },
    '@/lib/platform/server': {
      requireIdentity: async headers => ({ id: headers.get('cookie') === 'fixture=b' ? 'user-b' : 'user-a' }),
      validateOrigin() {},
    },
    '@/lib/http': { async readBoundedBytes() {
      reads++
      if (reads <= 2) await new Promise(resolve => blocked.push(resolve))
      throw new AiHttpError(408)
    } },
  }, { NEXT_PUBLIC_BACKEND: 'render' })
  const { PUT } = load(endpoint.route)
  const call = (session = 'a') => PUT(new Request('https://app.example.invalid/api/' + endpoint.path, {
    method: 'PUT', body: 'synthetic receipt', headers: { Cookie: 'fixture=' + session, 'Content-Type': endpoint.type },
  }), { params: Promise.resolve({ path: ['upload'] }) })

  const pending = [call(), call()]
  try {
    assert.equal((await call()).status, 429)
    assert.equal(reads, 2, 'the rejected upload never enters the reader')
    assert.equal((await call('b')).status, 408)
    assert.equal(reads, 3)
  } finally { blocked.forEach(release => release()) }
  assert.deepEqual((await Promise.all(pending)).map(response => response.status), [408, 408])
  assert.equal((await call()).status, 408)
})
