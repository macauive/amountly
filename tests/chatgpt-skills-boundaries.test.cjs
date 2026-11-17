const test = require('node:test')
const assert = require('node:assert/strict')
const load = require('./load-app.cjs')()
const { calculateReview } = load('src/lib/financial-review/calculate.ts')
const { day, storedDay, periodSchema } = load('src/lib/financial-review/contracts.ts')
const { syntheticSnapshot, syntheticId: id } = load('src/lib/financial-review/fixtures.ts')

const currencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD']
const period = { start: '2026-01-31', end: '2026-02-06', currency: 'USD' }
const asOf = new Date('2026-01-31T23:59:59Z').toISOString().slice(0, 10)
const clean = value => JSON.parse(JSON.stringify(value))
const emptySnapshot = () => ({ invoices: [], payments: [], bills: [], expenses: [] })

test('31 inclusive calendar days are accepted and the 32nd day is rejected, including leap February', () => {
  for (const [start, acceptedEnd, rejectedEnd] of [
    ['2026-01-01', '2026-01-31', '2026-02-01'],
    ['2024-02-01', '2024-03-02', '2024-03-03'],
  ]) {
    const accepted = { start, end: acceptedEnd, currency: 'USD' }
    assert.deepEqual(clean(periodSchema.parse(accepted)), accepted)
    assert.equal(calculateReview(emptySnapshot(), accepted, acceptedEnd).period.end, acceptedEnd)
    assert.equal(periodSchema.safeParse({ ...accepted, end: rejectedEnd }).success, false)
    assert.throws(() => calculateReview(emptySnapshot(), { ...accepted, end: rejectedEnd }, rejectedEnd))
  }
})

test('calendar contracts distinguish leap days and actual month lengths from date rollover', () => {
  for (const value of ['2000-02-29', '2024-02-29', '2026-02-28', '2026-04-30']) {
    assert.equal(day.parse(value), value)
    assert.equal(periodSchema.safeParse({ start: value, end: value, currency: 'USD' }).success, true)
  }
  for (const value of ['2025-02-29', '2024-02-30', '2026-04-31', '2026-13-01', '2026-01-00']) {
    assert.equal(day.safeParse(value).success, false, value)
    assert.equal(periodSchema.safeParse({ ...period, start: value }).success, false, value)
    assert.equal(periodSchema.safeParse({ ...period, end: value }).success, false, value)
  }
  assert.equal(storedDay.parse('2024-02-29'), '2024-02-29')
  assert.equal(storedDay.parse('2024-02-29T23:30:00-05:00'), '2024-03-01')
  assert.equal(storedDay.parse('2024-03-01T00:30:00+01:00'), '2024-02-29')
  assert.equal(storedDay.safeParse('2025-02-29T23:30:00-05:00').success, false)
})

test('every supported currency is retained while mixed-currency financial rows are excluded without conversion', async t => {
  const template = syntheticSnapshot()
  const rows = emptySnapshot()
  for (const [index, currency] of currencies.entries()) {
    const invoiceId = id(100 + index)
    rows.invoices.push({ ...template.invoices[0], id: invoiceId, currency, total: 100 + index, due_date: asOf })
    rows.payments.push({ ...template.payments[0], id: id(200 + index), invoice_id: invoiceId, amount: 1.25 })
    rows.bills.push({ ...template.bills[0], id: id(300 + index), currency, amount: 10 + index, due_date: asOf })
    rows.expenses.push({ ...template.expenses[3], id: id(400 + index), currency, amount: 20 + index, expense_date: asOf, receipt_path: 'synthetic-reference' })
  }
  for (const [index, currency] of currencies.entries()) {
    await t.test(currency, () => {
      const selectedPeriod = { ...period, currency }
      assert.equal(periodSchema.parse(selectedPeriod).currency, currency)
      const review = calculateReview(rows, selectedPeriod, asOf)
      assert.equal(review.period.currency, currency)
      assert.deepEqual(clean(review.totals), { unpaid: 98.75 + index, obligations: 10 + index, expenses: 20 + index })
      assert.deepEqual(clean(review.unpaid.map(row => row.source.id)), [id(100 + index)])
      assert.deepEqual(clean(review.obligations.map(row => row.source.id)), [id(300 + index)])
    })
  }
  assert.equal(periodSchema.safeParse({ ...period, currency: 'JPY' }).success, false)
})

test('bill horizon includes UTC as-of day plus seven calendar days and excludes the following day across a month boundary', () => {
  const template = syntheticSnapshot().bills[0]
  const rows = emptySnapshot()
  rows.bills = [
    { ...template, id: id(500), due_date: '2026-01-30', amount: 1 },
    { ...template, id: id(501), due_date: asOf, amount: 2 },
    { ...template, id: id(502), due_date: '2026-02-07', amount: 4 },
    { ...template, id: id(503), due_date: '2026-02-08', amount: 8 },
  ]
  const review = calculateReview(rows, period, asOf)
  assert.equal(review.asOf, '2026-01-31')
  assert.equal(review.horizon, '2026-02-07')
  assert.equal(review.totals.obligations, 7)
  assert.deepEqual(clean(review.obligations.map(({ source, due, overdue }) => ({ id: source.id, due, overdue }))), [
    { id: id(500), due: '2026-01-30', overdue: true },
    { id: id(501), due: '2026-01-31', overdue: false },
    { id: id(502), due: '2026-02-07', overdue: false },
  ])
})

test('zero, one, or two prior category records suppress the comparison flag while retaining the current expense', async t => {
  const template = syntheticSnapshot().expenses[0]
  const current = { ...template, id: id(600), amount: 1000, expense_date: asOf }
  const prior = [0, 1, 2].map(index => ({ ...template, id: id(610 + index), amount: 25, expense_date: `2026-01-${10 + index}` }))
  for (const count of [0, 1, 2]) {
    await t.test(`${count} qualifying prior records`, () => {
      const rows = emptySnapshot()
      rows.expenses = [...prior.slice(0, count), current]
      const review = calculateReview(rows, period, asOf)
      assert.equal(review.totals.expenses, 1000)
      assert.equal(review.findings.filter(finding => finding.id.startsWith('unusual:')).length, 0)
    })
  }
  const rows = emptySnapshot()
  rows.expenses = [prior[0], prior[1], { ...prior[2], currency: 'EUR' }, current]
  assert.equal(calculateReview(rows, period, asOf).findings.filter(finding => finding.id.startsWith('unusual:')).length, 0)
  rows.expenses[2] = prior[2]
  const review = calculateReview(rows, period, asOf)
  assert.equal(review.totals.expenses, 1000)
  assert.deepEqual(clean(review.findings.filter(finding => finding.id.startsWith('unusual:')).map(finding => finding.source.id)), [current.id])
})

test('invoice balances and totals use the exact remaining cents rather than the original invoice total', () => {
  const template = syntheticSnapshot()
  const rows = emptySnapshot()
  const invoiceId = id(700)
  rows.invoices = [{ ...template.invoices[0], id: invoiceId, total: '100.03', due_date: '2026-01-30' }]
  rows.payments = [
    { ...template.payments[0], id: id(710), invoice_id: invoiceId, amount: '20.01' },
    { ...template.payments[0], id: id(711), invoice_id: invoiceId, amount: '30.03' },
    { ...template.payments[0], id: id(712), invoice_id: invoiceId, amount: '49.99', reversal: [{ id: id(713) }] },
  ]
  const review = calculateReview(rows, period, asOf)
  assert.equal(review.totals.unpaid, 49.99)
  assert.equal(review.unpaid.length, 1)
  assert.equal(review.unpaid[0].amount, 49.99)
  assert.equal(review.unpaid[0].overdue, true)
  assert.equal(review.findings.find(finding => finding.id === `overdue:${invoiceId}`).source.id, invoiceId)
  assert.equal(rows.invoices[0].total, '100.03')
})
