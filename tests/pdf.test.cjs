const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const React = require('react')
const appLoader = require('./load-app.cjs')

async function requestPdf(options = {}) {
  let renders = 0, clients = 0
  const tables = []
  const client = {
    auth: { getUser: async () => options.auth ?? { data: { user: { id: 'synthetic-user' } }, error: null } },
    from: table => {
      tables.push(table)
      const result = table === 'invoices'
        ? options.invoice ?? { data: { invoice_number: 'QA', line_items: [] } }
        : options.payments ?? { data: [] }
      const query = { select: () => query, eq: () => query, order: () => query,
        maybeSingle: async () => result, range: async () => result }
      return query
    },
  }
  const load = appLoader({
    '@supabase/ssr': { createServerClient: () => { clients++; return client } },
    '@react-pdf/renderer': { renderToBuffer: async () => { renders++; throw Error('private renderer detail') } },
    '@/components/InvoicePDF': { InvoicePDF: () => null },
  })
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value },
    status(code) { this.code = code; return this }, json(body) { this.body = body; return this },
    send(body) { this.body = body; return this } }
  await load('src/pages/api/invoices/[id]/pdf.ts').default({
    method: options.method ?? 'GET', query: { id: options.id ?? '00000000-0000-4000-8000-000000000001' }, cookies: {},
  }, response)
  assert.equal(response.headers['Cache-Control'], 'private, no-store')
  assert.equal(response.headers['X-Content-Type-Options'], 'nosniff')
  assert.ok(!JSON.stringify(response.body).includes('private'))
  return { response, tables, renders, clients }
}

test('PDF route rejects unsupported methods and malformed identifiers before opening a client', async () => {
  const post = await requestPdf({ method: 'POST' })
  assert.equal(post.response.code, 405)
  assert.equal(post.response.headers.Allow, 'GET')
  assert.equal(post.clients, 0)
  for (const id of ['../invoice', ['00000000-0000-4000-8000-000000000001']]) {
    const invalid = await requestPdf({ id })
    assert.equal(invalid.response.code, 400)
    assert.equal(invalid.clients, 0)
  }
})

test('PDF route denies expired sessions before querying invoice data', async () => {
  const result = await requestPdf({ auth: { data: { user: null }, error: { message: 'private expired token detail' } } })
  assert.equal(result.response.code, 401)
  assert.deepEqual(result.tables, [])
  assert.equal(result.renders, 0)
})

test('PDF route rejects malformed or oversized legacy records without rendering', async () => {
  for (const data of [{ line_items: null }, { line_items: Array(101).fill({}) }, { line_items: [], notes: 'x'.repeat(250001) }]) {
    const result = await requestPdf({ invoice: { data } })
    assert.equal(result.response.code, 422)
    assert.deepEqual(result.tables, ['invoices'])
    assert.equal(result.renders, 0)
  }
})

test('PDF route returns safe errors for missing invoices, failed reads, and renderer failures', async () => {
  const missing = await requestPdf({ invoice: { data: null } })
  assert.equal(missing.response.code, 404)
  const invoiceFailure = await requestPdf({ invoice: { error: { message: 'private database detail' } } })
  assert.equal(invoiceFailure.response.code, 503)
  assert.equal(invoiceFailure.renders, 0)
  const paymentFailure = await requestPdf({ payments: { error: { message: 'private payment detail' } } })
  assert.equal(paymentFailure.response.code, 503)
  assert.equal(paymentFailure.renders, 0)
  const renderFailure = await requestPdf()
  assert.equal(renderFailure.response.code, 503)
  assert.equal(renderFailure.renders, 1)
})

test('PDF preserves issued identity, calendar dates, currency, partial balances and multi-page lines', async () => {
  const renderer = await import('@react-pdf/renderer')
  const load = appLoader({ '@react-pdf/renderer': renderer })
  const { mapInvoice } = load('src/lib/invoice-records.ts')
  const { InvoicePDF } = load('src/components/InvoicePDF.tsx')
  const { formatInvoiceDate, invoicePdfFilename } = load('src/lib/invoice-document.ts')
  assert.equal(formatInvoiceDate('2026-09-25T00:00:00+00:00'), 'September 25, 2026')
  assert.equal(invoicePdfFilename('../../untrusted/name'), 'invoice-______untrusted_name.pdf')
  const invoice = mapInvoice({ id: 'synthetic', invoice_number: 'QA-PDF', status: 'SENT',
    issue_date: '2026-09-25', due_date: '2099-10-25', currency: 'EUR', subtotal: 300, tax_rate: 0, tax_amount: 0, total: 300,
    client: { name: 'Changed identity', city: 'Changed city' },
    issued_snapshot: { client: { name: 'Issued client', address: 'Original address' } },
    payments: [{ amount: 100 }],
    line_items: Array.from({ length: 60 }, (_, n) => ({ id: String(n), description: `Work item ${String(n+1).padStart(2,'0')}`, quantity: 1, rate: 5, amount: 5 })),
  })
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amountly-pdf-'))
  try {
    const filename = path.join(root, 'invoice.pdf')
    fs.writeFileSync(filename, await renderer.renderToBuffer(React.createElement(InvoicePDF, { invoice })))
    const text = execFileSync('pdftotext', ['-layout', filename, '-'], { encoding: 'utf8' })
    for (const expected of ['Issued client','Original address','September 25, 2026','Payments recorded','Balance due','€100.00','€200.00','Work item 01','Work item 60','Page 2 of']) assert.ok(text.includes(expected), expected)
    assert.ok(!text.includes('Changed identity') && !text.includes('Changed city'))
    const legacy = { ...invoice, status: 'PAID', payments: [], amount_paid: 0, balance_due: 0, line_items: invoice.line_items.slice(0,1) }
    fs.writeFileSync(filename, await renderer.renderToBuffer(React.createElement(InvoicePDF, { invoice: legacy })))
    assert.match(execFileSync('pdftotext', [filename, '-'], { encoding: 'utf8' }), /Payment details\s+are unavailable/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
