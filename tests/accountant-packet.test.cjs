const test = require('node:test')
const assert = require('node:assert/strict')
const { unzipSync, strFromU8 } = require('fflate')
const loadApp = require('./load-app.cjs')

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ownerId = uuid(900)
const storageOrigin = 'https://synthetic-project.supabase.invalid'
const mib = 1024 * 1024
const period = { start: '2026-04-01', end: '2027-03-31', endExclusive: '2027-04-01' }
const query = { year: '2026', month: '4', currency: 'USD', basis: 'cash', start: period.start, end: period.end }

function packetLibrary(env = {}) {
  return loadApp({}, { NEXT_PUBLIC_SUPABASE_URL: storageOrigin, ...env })('src/lib/accountant-packet.ts')
}

function image(kind = 'png', size) {
  const signatures = {
    png: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    jpg: Buffer.from([255, 216, 255, 224]),
    webp: Buffer.from('RIFF0000WEBP'),
    pdf: Buffer.from('%PDF-1.7\n'),
  }
  const bytes = Buffer.alloc(size ?? signatures[kind].length + 24)
  signatures[kind].copy(bytes)
  return bytes
}

function expense(n = 1, patch = {}) {
  return {
    id: uuid(n), user_id: ownerId, expense_date: '2026-10-07', amount: 12.48,
    currency: 'USD', description: 'Synthetic expense', merchant: 'Synthetic Cafe',
    status: 'DRAFT', category: 'other', receipt_path: `${ownerId}/${uuid(n + 100)}.png`,
    receipt_url: null, reviewed_at: null,
    ...patch,
  }
}

function report(expenses = [expense()], patch = {}) {
  return {
    ownerId, period, currency: 'USD', basis: 'cash', expenses,
    rows: expenses.map(row => ({ id: row.id, date: row.expense_date.slice(0, 10), type: 'expense',
      name: row.description || row.merchant || 'Expense', amount: row.amount, status: row.status })),
    ...patch,
  }
}

function archive(result) {
  assert.equal(result.bytes instanceof Uint8Array, true)
  assert.match(result.filename, /^amountly-[a-z-]+-2026-04-01-2027-03-31-USD\.zip$/)
  const files = unzipSync(result.bytes)
  for (const required of ['records.csv', 'receipt-index.csv', 'README.txt']) assert.ok(files[required], `${required} exists`)
  for (const name of Object.keys(files)) assert.match(name, /^(records\.csv|receipt-index\.csv|README\.txt|receipts\/[0-9a-f-]{36}\.(jpg|png|webp|pdf))$/)
  return files
}

// Parse CSV independently of the application's encoder, including quoted
// commas, escaped quotes, and embedded newlines.
function csv(bytes) {
  const input = strFromU8(bytes), rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i++ }
      else quoted = !quoted
    } else if (char === ',' && !quoted) { row.push(field); field = '' }
    else if ((char === '\r' || char === '\n') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += char
  }
  assert.equal(quoted, false, 'CSV has no unterminated quoted fields')
  if (field || row.length) { row.push(field); rows.push(row) }
  const [headers, ...values] = rows
  assert.ok(headers.length)
  return values.map(values => {
    assert.equal(values.length, headers.length, 'CSV row has the correct field count')
    return Object.fromEntries(headers.map((header, i) => [header, values[i]]))
  })
}

test('packet query allows actual selected dates only inside its annual workspace period', () => {
  const { accountantPacketQuery } = packetLibrary()
  assert.equal(accountantPacketQuery.safeParse(query).success, true)
  assert.equal(accountantPacketQuery.safeParse({ ...query, start: '2026-05-01', end: '2026-05-01' }).success, true)
  assert.equal(accountantPacketQuery.safeParse({ ...query, year: '2028', month: '1', start: '2028-02-29', end: '2028-03-01' }).success, true)
  for (const patch of [
    { year: '1999' }, { year: '2101' }, { month: '0' }, { month: '13' },
    { currency: 'OTHER' }, { basis: 'unsupported' }, { month: ['4', '5'] },
    { start: '2026-05-02', end: '2026-05-01' }, { start: '2026-03-31' }, { end: '2027-04-01' },
    { start: '2026-02-29' }, { start: '2026-04-31' }, { end: '2027-02-30' },
    { start: '2026-4-01' }, { end: '2027-03-31T00:00:00Z' },
    { ownerId: uuid(901) }, { user_id: uuid(901) }, { organization_id: uuid(902) }, { filename: 'private-name.zip' },
  ]) assert.equal(accountantPacketQuery.safeParse({ ...query, ...patch }).success, false, JSON.stringify(patch))
})

test('packet joins records and receipt index by expense ID and preserves exact original bytes', async () => {
  const { buildAccountantPacket } = packetLibrary()
  const row = expense(1, { reviewed_at: '2026-10-07T12:00:00Z' })
  const original = image(), calls = []
  const files = archive(await buildAccountantPacket(report([row]), async path => {
    calls.push(path)
    return { bytes: original, mime: 'image/png' }
  }))
  assert.deepEqual(calls, [row.receipt_path])
  assert.deepEqual(Buffer.from(files[`receipts/${row.id}.png`]), original)
  const records = csv(files['records.csv']), index = csv(files['receipt-index.csv'])
  assert.equal(records.length, 1)
  assert.equal(index.length, 1)
  assert.ok(Object.values(records[0]).includes(row.id))
  assert.ok(Object.values(index[0]).includes(row.id))
  assert.ok(Object.values(index[0]).includes(`receipts/${row.id}.png`))
  assert.equal(index[0].review_state, 'Reviewed')
  assert.equal(index[0].sha256, require('node:crypto').createHash('sha256').update(original).digest('hex'))
  assert.match(strFromU8(files['records.csv']), /DRAFT/)
  assert.match(strFromU8(files['receipt-index.csv']), /2026-10-07/)
  const exportedMetadata = ['records.csv', 'receipt-index.csv', 'README.txt'].map(name => strFromU8(files[name])).join('\n')
  for (const excluded of [ownerId, uuid(101), row.receipt_path, storageOrigin, 'token=']) assert.equal(exportedMetadata.includes(excluded), false)
})

test('receipt originals use allowlisted formats and generated attachment names', async () => {
  const { buildAccountantPacket } = packetLibrary()
  const types = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' }
  const rows = Object.keys(types).map((ext, i) => expense(i + 1, { receipt_path: `${ownerId}/${uuid(i + 101)}.${ext}` }))
  const files = archive(await buildAccountantPacket(report(rows), async path => {
    const ext = path.split('.').pop()
    return { bytes: image(ext), mime: types[ext] }
  }))
  for (let i = 0; i < rows.length; i++) {
    const ext = Object.keys(types)[i]
    assert.deepEqual(Buffer.from(files[`receipts/${rows[i].id}.${ext}`]), image(ext))
  }
})

test('a missing reference and an unavailable original are explicit in the receipt index', async () => {
  const { buildAccountantPacket } = packetLibrary()
  const rows = [expense(1, { receipt_path: null }), expense(2)]
  const calls = []
  const files = archive(await buildAccountantPacket(report(rows), async path => { calls.push(path); return null }))
  assert.deepEqual(calls, [rows[1].receipt_path])
  assert.equal(Object.keys(files).filter(name => name.startsWith('receipts/')).length, 0)
  const index = csv(files['receipt-index.csv'])
  assert.equal(index.length, 2)
  assert.ok(index.every(row => Object.values(row).some(value => /missing|not_attached|none|unavailable/i.test(value))))
})

test('legacy signed URLs resolve only a trusted own storage path and never fetch a URL', async () => {
  const { buildAccountantPacket } = packetLibrary()
  const path = `${ownerId}/${uuid(101)}.png`
  const row = expense(1, { receipt_path: null, receipt_url: `${storageOrigin}/storage/v1/object/sign/receipts/${path}?token=synthetic-legacy-query` })
  const calls = []
  const files = archive(await buildAccountantPacket(report([row]), async value => {
    calls.push(value); return { bytes: image(), mime: 'image/png' }
  }, { storageOrigin }))
  assert.deepEqual(calls, [path])
  assert.ok(files[`receipts/${row.id}.png`])
  assert.equal(strFromU8(files['receipt-index.csv']).includes('synthetic-legacy-query'), false)
  assert.equal(strFromU8(files['records.csv']).includes(storageOrigin), false)
})

test('untrusted legacy references are indexed as unsupported without reading an original', async () => {
  const { buildAccountantPacket } = packetLibrary()
  const path = `${ownerId}/${uuid(101)}.png`
  for (const url of [
    `https://untrusted.invalid/storage/v1/object/sign/receipts/${path}`,
    `${storageOrigin}:444/storage/v1/object/sign/receipts/${path}`,
    `${storageOrigin}/storage/v1/object/public/receipts/${path}`,
    `http://synthetic-project.supabase.invalid/storage/v1/object/sign/receipts/${path}`,
    'not a URL',
  ]) {
    let reads = 0
    const files = archive(await buildAccountantPacket(report([expense(1, { receipt_path: null, receipt_url: url })]), async () => { reads++; throw new Error('Must not read') }, { storageOrigin }))
    assert.equal(reads, 0)
    assert.match(strFromU8(files['receipt-index.csv']), /unsupported/i)
    assert.equal(strFromU8(files['receipt-index.csv']).includes(url), false)
  }
})

test('foreign receipt ownership and invalid private paths fail before reading a file', async () => {
  const { buildAccountantPacket, PacketIntegrityError } = packetLibrary()
  for (const path of [
    `${uuid(901)}/${uuid(101)}.png`, `${ownerId}/../receipt.png`,
    `/${ownerId}/${uuid(101)}.png`, `${ownerId}\\${uuid(101)}.png`,
    `${ownerId}/%2e%2e/receipt.png`, `${ownerId}/${uuid(101)}.html`,
    `${ownerId}/${uuid(101)}.png?token=synthetic-query`,
    `${storageOrigin}/storage/v1/object/sign/receipts/${ownerId}/${uuid(101)}.png`,
  ]) {
    let reads = 0
    await assert.rejects(buildAccountantPacket(report([expense(1, { receipt_path: path })]), async () => { reads++; return null }), PacketIntegrityError)
    assert.equal(reads, 0)
  }
  let reads = 0
  await assert.rejects(buildAccountantPacket(report([expense(1, { user_id: uuid(901) })]), async () => { reads++; return null }), PacketIntegrityError)
  assert.equal(reads, 0)
})

test('a trusted legacy reference cannot cross receipt owners', async () => {
  const { buildAccountantPacket, PacketIntegrityError } = packetLibrary()
  let reads = 0
  const row = expense(1, { receipt_path: null, receipt_url: `${storageOrigin}/storage/v1/object/sign/receipts/${uuid(901)}/${uuid(101)}.png` })
  await assert.rejects(buildAccountantPacket(report([row]), async () => { reads++; return null }, { storageOrigin }), PacketIntegrityError)
  assert.equal(reads, 0)
})

test('packet rejects inconsistent record membership, duplicate expense IDs and out-of-period evidence before reading originals', async () => {
  const { buildAccountantPacket, PacketIntegrityError } = packetLibrary()
  const good = report()
  for (const invalid of [
    report([expense(1, { currency: 'EUR' })]),
    report([expense(1, { expense_date: '2026-03-31' })]),
    report([expense(1, { expense_date: '2027-04-01' })]),
    { ...good, rows: [] },
    { ...good, expenses: [] },
    { ...good, rows: [good.rows[0], good.rows[0]] },
    { ...good, expenses: [good.expenses[0], good.expenses[0]] },
    { ...good, rows: [{ ...good.rows[0], id: uuid(2) }] },
    { ...good, rows: [{ ...good.rows[0], date: '2027-04-01' }] },
    { ...good, period: { ...period, endExclusive: '2027-04-02' } },
  ]) {
    let reads = 0
    await assert.rejects(buildAccountantPacket(invalid, async () => { reads++; return null }), PacketIntegrityError)
    assert.equal(reads, 0)
  }
})

test('MIME, extension, signature, and nonempty bytes must agree before inclusion', async () => {
  const { buildAccountantPacket, PacketIntegrityError } = packetLibrary()
  for (const result of [
    { bytes: image('pdf'), mime: 'image/png' },
    { bytes: image('png'), mime: 'application/pdf' },
    { bytes: image('png'), mime: 'text/html' },
    { bytes: Buffer.alloc(0), mime: 'image/png' },
    { bytes: Buffer.from('<html>synthetic</html>'), mime: 'image/png' },
  ]) await assert.rejects(buildAccountantPacket(report(), async () => result), PacketIntegrityError)
})

test('CSV text remains formula safe and quotes survive a roundtrip', async () => {
  const { buildAccountantPacket } = packetLibrary()
  for (const value of ['=1+1', '+SUM(1,2)', '-1+2', '@SUM(1,2)', '  =1+1']) {
    const row = expense(1, { description: value, merchant: value, category: value, receipt_path: null })
    const files = archive(await buildAccountantPacket(report([row]), async () => { throw new Error('Must not read') }))
    const records = csv(files['records.csv']), index = csv(files['receipt-index.csv'])
    assert.ok(Object.values(records[0]).some(field => field.startsWith("'") && field.includes(value.trim())))
    assert.ok(Object.values(index[0]).some(field => field.startsWith("'") && field.includes(value.trim())))
  }
  const value = 'Synthetic, "quoted"\nsecond line'
  const files = archive(await buildAccountantPacket(report([expense(1, { description: value, receipt_path: null })]), async () => null))
  assert.ok(Object.values(csv(files['records.csv'])[0]).includes(value))
})

test('reader failures abort packet generation even after an earlier original succeeded', async () => {
  const { buildAccountantPacket } = packetLibrary()
  let reads = 0
  await assert.rejects(buildAccountantPacket(report([expense(1), expense(2)]), async () => {
    reads++
    if (reads === 2) throw new Error('Synthetic storage failure')
    return { bytes: image(), mime: 'image/png' }
  }))
  assert.equal(reads, 2)
})

test('receipt reference counts and individual original sizes are bounded', async () => {
  const { buildAccountantPacket } = packetLibrary()
  await assert.rejects(buildAccountantPacket(report(Array.from({ length: 101 }, (_, i) => expense(i + 1))), async () => ({ bytes: image(), mime: 'image/png' })))
  await assert.rejects(buildAccountantPacket(report(), async () => ({ bytes: image('png', 10 * mib + 1), mime: 'image/png' })))
  const result = await buildAccountantPacket(report(), async () => ({ bytes: image('png', 10 * mib), mime: 'image/png' }))
  assert.equal(unzipSync(result.bytes)[`receipts/${uuid(1)}.png`].byteLength, 10 * mib)
})

test('combined original bytes permit the boundary and reject overflow without truncation', async () => {
  const { buildAccountantPacket } = packetLibrary()
  const rows = [expense(1), expense(2), expense(3)]
  for (const extra of [0, 1]) {
    let reads = 0
    const pending = buildAccountantPacket(report(rows), async () => {
      const size = reads++ < 2 ? 10 * mib : 5 * mib + extra
      return { bytes: image('png', size), mime: 'image/png' }
    })
    if (extra) await assert.rejects(pending)
    else {
      const files = unzipSync((await pending).bytes)
      assert.equal(rows.reduce((total, row) => total + files[`receipts/${row.id}.png`].byteLength, 0), 25 * mib)
    }
  }
})

test('metadata bounds prevent a large CSV from producing an archive', async () => {
  const { buildAccountantPacket } = packetLibrary()
  const rows = Array.from({ length: 300 }, (_, i) => expense(i + 1, { description: 'x'.repeat(7000), receipt_path: null }))
  await assert.rejects(buildAccountantPacket(report(rows), async () => { throw new Error('Must not read') }))
})
