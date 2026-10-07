const test = require('node:test')
const assert = require('node:assert/strict')
const load = require('./load-app.cjs')()('src/lib/expense-navigation.ts')
const id = '00000000-0000-4000-8000-000000000012'
const defaults = { query: '', start: '', end: '', category: 'all', status: 'all' }
const rows = [
  { id: 'first', merchant: 'Paper Studio', description: 'Notebooks', amount: 12, currency: 'USD', expense_date: '2026-10-01', category: 'OFFICE_SUPPLIES', status: 'DRAFT' },
  { id: 'second', merchant: 'App Maker', description: 'Design subscription', amount: 20, currency: 'EUR', expense_date: '2026-10-07', category: 'SOFTWARE', status: 'APPROVED' },
]
test('expense links always stay on the fixed route and navigation rejects ambiguous or forged input', () => {
  assert.equal(load.expenseHref(id), `/expenses?expense=${id}`)
  for (const value of ['javascript:alert(1)', '../../private', 'x?user_id=foreign', '']) assert.equal(load.expenseHref(value), '/expenses')
  for (const query of ['expense=../../private', `expense=${id}&expense=${id}`, 'action=delete', `expense=${id}&action=upload-receipt`, 'status=OWNER', 'status=DRAFT&status=APPROVED']) {
    const value = load.expenseNavigation(new URLSearchParams(query))
    assert.equal(value.invalid, true); assert.equal(value.expenseId, null); assert.equal(value.uploadReceipt, false)
  }
  assert.equal(load.expenseNavigation(new URLSearchParams(`expense=${id}`)).expenseId, id)
  assert.equal(load.expenseNavigation(new URLSearchParams('action=upload-receipt')).uploadReceipt, true)
  assert.equal(load.expenseNavigation(new URLSearchParams('status=DRAFT')).status, 'DRAFT')
})
test('expense filters combine text, inclusive dates, category and status without merging currencies or mutating rows', () => {
  const original = JSON.stringify(rows)
  const result = load.filterExpenseList(rows, { ...defaults, query: ' ＰＡＰＥＲ ', start: '2026-10-01', end: '2026-10-01', category: 'OFFICE_SUPPLIES', status: 'DRAFT' })
  assert.deepEqual(result.map(row => row.id), ['first'])
  assert.equal(load.filterExpenseList(rows, { ...defaults, query: 'subscription' })[0].currency, 'EUR')
  assert.equal(load.filterExpenseList(rows, { ...defaults, query: 'no match' }).length, 0)
  assert.equal(JSON.stringify(rows), original)
})
test('invalid filter ranges and unsupported enum values fail closed', () => {
  for (const patch of [{ start: '2026-02-30' }, { end: 'invalid' }, { start: '2026-10-07', end: '2026-10-01' }, { category: 'OWNER' }, { status: 'delete' }]) {
    assert.equal(load.filterExpenseList(rows, { ...defaults, ...patch }).length, 0)
  }
})
