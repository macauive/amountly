// Real Auth + PostgREST + application HTTP tests. Synthetic fixtures stay local.
const assert = require('node:assert/strict')
const { randomUUID, randomBytes, createHmac } = require('node:crypto')
const { createClient } = require('@supabase/supabase-js')
const loadApp = require('./load-app.cjs')
const s = require('./local-supabase.cjs')()
const appOrigin = process.env.AMOUNTLY_TEST_APP_ORIGIN || 'http://localhost:4174'
if (!['http://localhost:4174', 'http://127.0.0.1:4174'].includes(appOrigin)) throw Error('Refusing non-local app')
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(s.API_URL, s.SERVICE_ROLE_KEY, options)
const clients = []
async function ok(promise, label) {
  const result = await promise
  assert.ok(!result.error, `${label}: ${result.error?.code || 'failed'}`)
  return result.data
}
async function account(type, organizationId) {
  const email = `review-${randomUUID()}@example.invalid`, password = `Qa9!${randomBytes(24).toString('base64url')}`
  const { user } = await ok(admin.auth.admin.createUser({ email, password, email_confirm: true }), 'create local identity')
  const client = createClient(s.API_URL, s.ANON_KEY, options); clients.push(client)
  const { session } = await ok(client.auth.signInWithPassword({ email, password }), 'sign in locally')
  let org = organizationId ? { id: organizationId } : null
  if (org) {
    await ok(admin.from('users').insert({ id: user.id, email, name: 'Synthetic member', account_type: type, role: 'MEMBER', organization_id: org.id }), 'seed local member')
  } else {
    const profile = loadApp({ '@/lib/supabase': { getSupabaseClient: () => client } })('src/services/profile.service.ts')
    await profile.ensureOwnProfile(user, type)
    await ok(client.rpc('set_own_account_type', { account_type_param: type }), 'choose local account type')
    if (type === 'business') {
      org = await ok(client.from('organizations').insert({ name: 'Synthetic review workspace' }).select().single(), 'create local workspace')
      await ok(client.from('users').update({ organization_id: org.id, role: 'OWNER' }).eq('id', user.id), 'set local owner')
    }
  }
  return { client, user, org, token: session.access_token }
}
const today = new Date().toISOString().slice(0, 10)
const shift = days => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
const period = { start: shift(-6), end: today, currency: 'USD' }
async function request(actor, path, body, expected = 200, extraHeaders = {}) {
  const response = await fetch(appOrigin + path, { method: 'POST', headers: {
    'content-type': 'application/json', origin: appOrigin,
    ...(actor ? { authorization: `Bearer ${actor.token}` } : {}), ...extraHeaders,
  }, body: JSON.stringify(body) })
  assert.equal(response.status, expected, `${path} returned ${response.status}, expected ${expected}`)
  assert.match(response.headers.get('cache-control'), /no-store/)
  return response.json()
}
const review = (actor, input = period, status = 200, headers) => request(actor, '/api/financial-review', input, status, headers)
const record = (actor, kind, id, status = 200) => request(actor, '/api/financial-review/record', { kind, id }, status)
const scope = actor => ({ user_id: actor.org ? null : actor.user.id, organization_id: actor.org?.id || null })
async function invoice(actor, total, suffix, overrides = {}) {
  const customer = await ok(admin.from('clients').insert({ ...scope(actor), name: 'Synthetic review client' }).select().single(), 'seed client')
  return ok(admin.from('invoices').insert({ ...scope(actor), client_id: customer.id, invoice_number: `REVIEW-${suffix}`, total, subtotal: total,
    currency: 'USD', status: 'SENT', issue_date: shift(-20), due_date: shift(-1), ...overrides }).select().single(), 'seed invoice')
}
async function expense(actor, amount, overrides = {}) {
  return ok(admin.from('expenses').insert({ user_id: actor.user.id, amount,
    currency: 'USD', expense_date: today, description: 'Synthetic review expense', category: 'OFFICE_SUPPLIES', status: 'DRAFT', ...overrides }).select().single(), 'seed expense')
}
async function main() {
  const owner = await account('business'), outsider = await account('business')
  const member = await account('business', owner.org.id), personal = await account('personal'), freelancer = await account('freelancer')
  const issued = await invoice(owner, 1000, 'PARTIAL')
  const payments = await ok(admin.from('invoice_payments').insert([250, 100].map(amount => ({ id: randomUUID(), invoice_id: issued.id,
    amount, paid_on: today, method: 'other', recorded_by: owner.user.id }))).select(), 'seed payments')
  await ok(admin.from('invoice_payment_reversals').insert({ id: randomUUID(), payment_id: payments.find(p => Number(p.amount) === 100).id,
    reason: 'Synthetic correction', recorded_by: owner.user.id }), 'seed reversed receipt')
  await invoice(owner, 999, 'DRAFT', { status: 'DRAFT' })
  await invoice(owner, 999, 'PAID', { status: 'PAID' })
  await invoice(owner, 999, 'CANCELLED', { status: 'CANCELLED' })
  await invoice(owner, 200, 'EUR', { currency: 'EUR' })
  const foreignInvoice = await invoice(outsider, 888, 'FOREIGN')
  const ownedExpense = await expense(owner, 420)
  const memberExpense = await expense(member, 25, { expense_date: `${today}T23:59:59Z` })
  const foreignExpense = await expense(outsider, 888)
  const withReceipt = await expense(owner, 5, { receipt_path: `${owner.user.id}/synthetic-reference.png` })
  await expense(owner, 999, { status: 'REJECTED' })
  await expense(owner, 999, { archived_at: new Date().toISOString() })
  await expense(owner, 999, { expense_date: shift(1) })
  await expense(owner, 999, { currency: 'EUR' })
  for (const days of [-7, -8, -9]) await expense(owner, 40, { expense_date: shift(days) })
  const vendor = await ok(admin.from('vendors').insert({ user_id: owner.user.id, organization_id: owner.org.id, name: 'Synthetic review supplier' }).select().single(), 'seed supplier')
  const vendorRows = await ok(admin.from('vendor_bills').insert([
    { total: 900, status: 'upcoming', due_date: shift(2) }, { total: 999, status: 'paid', due_date: today },
    { total: 999, status: 'cancelled', due_date: today }, { total: 999, status: 'upcoming', due_date: shift(8) },
  ].map((row, i) => ({ user_id: owner.user.id, organization_id: owner.org.id, vendor_id: vendor.id, bill_number: `REVIEW-${i}`,
    date: today, currency: 'USD', subtotal: row.total, ...row }))).select(), 'seed obligations')
  await ok(admin.from('bills').insert({ user_id: personal.user.id, name: 'Synthetic personal bill', payee: 'Synthetic payee', amount: 65, currency: 'USD',
    due_date: shift(-1), status: 'upcoming', recurrence: 'once', category: 'other' }), 'seed personal bill')
  const freeInvoice = await invoice(freelancer, 150, 'FREELANCE')

  const result = await review(owner)
  assert.equal(result.synthetic, false)
  assert.deepEqual(result.totals, { unpaid: 750, obligations: 900, expenses: 450 })
  assert.equal(result.unpaid.length, 1)
  assert.ok(result.findings.some(f => f.id === `unusual:${ownedExpense.id}`))
  assert.ok(result.findings.some(f => f.id === `receipt:${memberExpense.id}`))
  assert.ok(!result.findings.some(f => f.id === `receipt:${withReceipt.id}`))
  assert.ok(!JSON.stringify(result).includes('synthetic-reference.png'))
  assert.deepEqual((await review(owner, { ...period, currency: 'EUR' })).totals, { unpaid: 200, obligations: 0, expenses: 999 })
  console.log('PASS: real HTTP review reconciles partial/reversed receipts, obligations, date/currency filters, receipt flags and unusual expenses')

  assert.deepEqual((await review(member)).totals, { unpaid: 0, obligations: 0, expenses: 25 })
  assert.deepEqual((await review(outsider)).totals, { unpaid: 888, obligations: 0, expenses: 888 })
  assert.deepEqual((await review(personal)).totals, { unpaid: 0, obligations: 65, expenses: 0 })
  assert.equal((await review(freelancer)).totals.unpaid, 150)
  for (const [kind, id, amount] of [['invoices', issued.id, 1000], ['expenses', ownedExpense.id, 420], ['vendor_bills', vendorRows[0].id, 900]]) {
    assert.equal((await record(owner, kind, id)).amount, amount)
    await record(outsider, kind, id, 404)
    await record(member, kind, id, kind === 'expenses' ? 404 : 403)
  }
  await record(owner, 'invoices', foreignInvoice.id, 404)
  await record(owner, 'expenses', foreignExpense.id, 404)
  await record(freelancer, 'invoices', issued.id, 404)
  assert.equal((await record(freelancer, 'invoices', freeInvoice.id)).amount, 150)
  const safeReceipt = await record(owner, 'expenses', withReceipt.id)
  assert.equal(safeReceipt.receiptAttached, true)
  assert.equal(safeReceipt.receipt_path, undefined); assert.equal(safeReceipt.receipt_url, undefined)
  assert.deepEqual(await ok(outsider.client.from('invoices').select('id').eq('id', issued.id), 'foreign invoice RLS'), [])
  assert.deepEqual(await ok(member.client.from('expenses').select('id').eq('id', ownedExpense.id), 'member expense RLS'), [])
  console.log('PASS: owner/member/personal/freelancer capabilities, foreign-record denial, database RLS and supporting-record redaction')

  await review(null, period, 401)
  await record(null, 'invoices', issued.id, 401)
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const expired = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: owner.user.id, aud: 'authenticated', role: 'authenticated', exp: 1 })}`
  const expiredActor = { token: `${expired}.${createHmac('sha256', s.JWT_SECRET).update(expired).digest('base64url')}` }
  await review(expiredActor, period, 401); await record(expiredActor, 'invoices', issued.id, 401)
  await review(owner, period, 403, { origin: 'https://example.invalid' })
  await review(owner, { ...period, userId: outsider.user.id }, 400)
  await ok(admin.from('users').update({ is_active: false }).eq('id', owner.user.id), 'disable local actor')
  await review(owner, period, 403); await record(owner, 'invoices', issued.id, 403)
  await ok(admin.from('users').update({ is_active: true, role: 'MEMBER' }).eq('id', owner.user.id), 'demote local actor')
  assert.deepEqual((await review(owner)).totals, { unpaid: 0, obligations: 0, expenses: 425 })
  await record(owner, 'invoices', issued.id, 403)
  await ok(admin.from('users').update({ role: 'OWNER' }).eq('id', owner.user.id), 'restore local actor')
  console.log('PASS: anonymous/expired/disabled sessions, cross-origin and forged ownership denied; role changes apply to existing tokens')

  const bulk = Array.from({ length: 205 }, (_, n) => ({ id: randomUUID(), ...scope(freelancer), client_id: freeInvoice.client_id,
    invoice_number: `PAGE-${n}`, total: 1, subtotal: 1, currency: 'USD', status: 'SENT', issue_date: today, due_date: shift(10) }))
  await ok(admin.from('invoices').insert(bulk), 'seed pagination boundary')
  const paged = await review(freelancer)
  assert.equal(paged.unpaid.length, 206); assert.equal(paged.totals.unpaid, 355)
  assert.equal(new Set(paged.unpaid.map(row => row.source.id)).size, 206)
  assert.equal((await request(owner, '/api/financial-review/agent', period, 404)).error, 'Agent preview is not enabled.')
  console.log('PASS: real PostgREST review pagination has no missing/duplicate balances; account-mode agent stays disabled')
}
main().catch(error => { console.error('FAIL:', error.name, error.message); process.exitCode = 1 })
  .finally(() => { for (const client of clients) client.auth.stopAutoRefresh() })
