const test = require('node:test')
const assert = require('node:assert/strict')
const loadApp = require('./load-app.cjs')

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ownerId = uuid(99)
const query = { year: 2026, month: 4, currency: 'USD', basis: 'cash' }
const period = { start: '2026-10-01', end: '2026-10-31', endExclusive: '2026-11-01' }
const invoice = { invoice_number: 'Synthetic invoice', currency: 'USD', status: 'SENT', user_id: ownerId }
const payment = { id: uuid(1), paid_on: period.start, amount: '25.00', invoice, reversal: null }
const issued = { ...invoice, id: uuid(2), issue_date: period.start, total: '25.00' }
const expense = { id: uuid(3), expense_date: period.end, amount: '12.50', currency: 'USD',
  description: 'Synthetic expense', merchant: null, status: 'DRAFT', user_id: ownerId,
  category: 'other', receipt_path: `${ownerId}/${uuid(4)}.png`, receipt_url: null, reviewed_at: null }

function harness(data = {}) {
  const calls = []
  const client = { from: table => {
    const call = { table, filters: [] }
    calls.push(call)
    const builder = {
      select(fields) { call.fields = fields; return builder },
      async range(from, to) {
        call.range = [from, to]
        const value = Object.hasOwn(data, table) ? data[table] : table === 'invoice_payments' ? [payment] : table === 'invoices' ? [issued] : [expense]
        return { data: typeof value === 'function' ? value(from, to) : value, error: null }
      },
    }
    for (const op of ['eq', 'in', 'gte', 'lt', 'order', 'is', 'neq']) builder[op] = (...args) => { call.filters.push([op, ...args]); return builder }
    return builder
  } }
  const { loadWorkspaceReport } = loadApp()('src/lib/workspace-report.ts')
  return { calls, run: (patch = {}, scopePatch = {}) => loadWorkspaceReport(client, { ...query, ...patch }, { ownerId, period, ...scopePatch }) }
}

test('scoped cash report uses only the owner, selected dates and currency and excludes rejected/archived expenses', async () => {
  const h = harness()
  const report = await h.run()
  assert.deepEqual(h.calls.map(call => call.table), ['invoice_payments', 'expenses'])
  for (const call of h.calls) {
    const field = call.table === 'invoice_payments' ? 'paid_on' : 'expense_date'
    const ownerField = call.table === 'invoice_payments' ? 'invoice.user_id' : 'user_id'
    const currencyField = call.table === 'invoice_payments' ? 'invoice.currency' : 'currency'
    assert.ok(call.filters.some(filter => filter[0] === 'eq' && filter[1] === ownerField && filter[2] === ownerId))
    assert.ok(call.filters.some(filter => filter[0] === 'eq' && filter[1] === currencyField && filter[2] === query.currency))
    assert.ok(call.filters.some(filter => filter[0] === 'gte' && filter[1] === field && filter[2] === period.start))
    assert.ok(call.filters.some(filter => filter[0] === 'lt' && filter[1] === field && filter[2] === period.endExclusive))
    assert.ok(!call.fields.includes('*'))
  }
  const expenses = h.calls.find(call => call.table === 'expenses')
  assert.ok(expenses.filters.some(filter => filter[0] === 'is' && filter[1] === 'archived_at' && filter[2] === null))
  assert.ok(expenses.filters.some(filter => filter[0] === 'neq' && filter[1] === 'status' && filter[2] === 'REJECTED'))
  for (const field of ['receipt_path', 'receipt_url', 'reviewed_at', 'user_id']) assert.ok(expenses.fields.includes(field))
  assert.equal(report.rows.length, 2)
  assert.equal(report.expenses.length, 1)
  assert.equal(report.rows[0].date, period.start)
  assert.equal(report.rows[1].date, period.end)
  assert.equal(report.expenses[0].receipt_path, expense.receipt_path)
  assert.equal(report.period, period)
})

test('scoped accrual report filters issued invoices by owner and selected period without reading payments', async () => {
  const h = harness()
  const report = await h.run({ basis: 'accrual' })
  assert.deepEqual(h.calls.map(call => call.table), ['invoices', 'expenses'])
  const call = h.calls[0]
  assert.ok(call.fields.includes('user_id'))
  assert.ok(call.filters.some(filter => filter[0] === 'eq' && filter[1] === 'user_id' && filter[2] === ownerId))
  assert.ok(call.filters.some(filter => filter[0] === 'gte' && filter[1] === 'issue_date' && filter[2] === period.start))
  assert.ok(call.filters.some(filter => filter[0] === 'lt' && filter[1] === 'issue_date' && filter[2] === period.endExclusive))
  assert.ok(call.filters.some(filter => filter[0] === 'eq' && filter[1] === 'currency' && filter[2] === query.currency))
  assert.equal(report.rows.find(row => row.type === 'income').id, issued.id)
})

test('cash report rejects returned payment records with foreign invoice ownership, wrong currency or dates outside the subperiod', async () => {
  for (const patch of [{ invoice: { ...invoice, user_id: uuid(100) } }, { invoice: { ...invoice, currency: 'EUR' } },
    { paid_on: '2026-09-30' }, { paid_on: period.endExclusive },
    { invoice: { ...invoice, user_id: uuid(100) }, reversal: { id: uuid(7) } }]) {
    const h = harness({ invoice_payments: [{ ...payment, ...patch }] })
    await assert.rejects(h.run(), /Report scope mismatch/)
    assert.deepEqual(h.calls.map(call => call.table), ['invoice_payments'])
  }
})

test('accrual report rejects returned invoice records with foreign ownership, wrong currency or dates outside the subperiod', async () => {
  for (const patch of [{ user_id: uuid(100) }, { currency: 'EUR' }, { issue_date: '2026-09-30' }, { issue_date: period.endExclusive }]) {
    const h = harness({ invoices: [{ ...issued, ...patch }] })
    await assert.rejects(h.run({ basis: 'accrual' }), /Report scope mismatch/)
    assert.deepEqual(h.calls.map(call => call.table), ['invoices'])
  }
})

test('scoped report rejects returned expenses with foreign ownership, wrong currency or dates outside the subperiod', async () => {
  for (const patch of [{ user_id: uuid(100) }, { currency: 'EUR' }, { expense_date: '2026-09-30' }, { expense_date: period.endExclusive }]) {
    const h = harness({ expenses: [{ ...expense, ...patch }] })
    await assert.rejects(h.run(), /Report scope mismatch/)
  }
})

test('scoped report normalizes valid timestamps but rejects missing evidence and expired reads', async () => {
  const timestamped = harness({ expenses: [{ ...expense, expense_date: `${period.end}T15:00:00+00:00` }] })
  const report = await timestamped.run()
  assert.equal(report.expenses[0].expense_date, period.end)
  for (const patch of [{ user_id: undefined }, { receipt_path: undefined }, { reviewed_at: 'not-a-date' }, { expense_date: '2026-10-32' }]) {
    await assert.rejects(harness({ expenses: [{ ...expense, ...patch }] }).run())
  }
  const expired = harness()
  await assert.rejects(expired.run({}, { deadline: Date.now() - 1000 }), /Report timed out/)
  assert.equal(expired.calls.length, 0)
  const invalidOwner = harness()
  await assert.rejects(invalidOwner.run({}, { ownerId: 'not-a-uuid' }))
  assert.equal(invalidOwner.calls.length, 0)
})
