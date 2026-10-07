const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const workerThreads = require('node:worker_threads')

// Run after the default production build, or inside its Docker image with
// AMOUNTLY_STANDALONE_ROOT=/app. This loads the bundled validator, never TS.
const root = path.resolve(process.env.AMOUNTLY_STANDALONE_ROOT || '.next/standalone')
const routePath = path.join(root, '.next/server/app/api/ai/receipt/route.js')
const routeSource = fs.readFileSync(routePath, 'utf8')
assert.match(routeSource, /\[turbopack\]_runtime/, 'Build with the default Turbopack compiler before this regression test')

const launches = []
const NativeWorker = workerThreads.Worker
workerThreads.Worker = class extends NativeWorker {
  constructor(filename, options) {
    launches.push({ filename, options })
    super(filename, options)
  }
}
const originalDirectory = process.cwd()
process.chdir(root)
test.after(() => { workerThreads.Worker = NativeWorker; process.chdir(originalDirectory) })

// Turbopack module IDs and chunk names change with a build. Discover the
// validator by its export in the actual receipt route's registered factories.
const chunks = Array.from(routeSource.matchAll(/R\.c\("([^\"]+)"\)/g), match => match[1])
let validatorId
for (const chunk of chunks) {
  const entries = require(path.join(root, '.next', chunk))
  for (let index = 1; index < entries.length; index++) {
    if (typeof entries[index] === 'function'
      && /\["validateReceiptFile",/.test(entries[index].toString())) validatorId = entries[index - 1]
  }
}
assert.notEqual(validatorId, undefined, 'The receipt route must contain the production validator')
require(routePath)
const runtime = require(path.join(root, '.next/server/chunks/[turbopack]_runtime.js'))('server/app/api/ai/receipt/route.js')
const validator = Promise.resolve(runtime.m(validatorId).exports).then(exports => exports.validateReceiptFile)

// Reproduce the exact 853-byte Helvetica fixture that exposed the deployed bug.
// Every word is synthetic; offsets and stream length are calculated explicitly.
function textReceiptPdf() {
  const stream = [
    'BT /F1 18 Tf 72 720 Td (DEMO / SYNTHETIC RECEIPT) Tj',
    '0 -45 Td (Demo Stationery) Tj', '0 -45 Td (Date: 2026-10-06) Tj',
    '0 -45 Td (Currency: USD) Tj', '0 -45 Td (Notebook and pen: 12.00) Tj',
    '0 -45 Td (Sales tax: 0.50) Tj', '0 -45 Td (TOTAL USD 12.50) Tj',
    '0 -45 Td (Paid in full - card) Tj', '0 -45 Td (Synthetic QA only) Tj ET',
  ].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let source = '%PDF-1.7\n'
  const offsets = []
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source))
    source += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(source)
  source += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  source += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(source)
}

test('bundled receipt validator launches the traced raw worker with unchanged typed PDF bytes', async () => {
  const validate = await validator
  const pdf = textReceiptPdf()
  assert.equal(pdf.length, 853)
  const result = await validate(pdf, 'application/pdf')
  assert.equal(result.mime, 'application/pdf')
  assert.deepEqual(result.data, pdf)
  assert.equal(launches.length, 1)
  assert.equal(launches[0].filename, path.join(root, 'scripts/receipt-pdf-worker.mjs'))
  assert.ok(launches[0].options.workerData instanceof Uint8Array)
  assert.deepEqual(Buffer.from(launches[0].options.workerData), pdf)
  assert.deepEqual(launches[0].options.resourceLimits, { maxOldGenerationSizeMb: 128 })
  assert.deepEqual(launches[0].options.execArgv, [])
  assert.equal(launches[0].options.stdout, true)
  assert.equal(launches[0].options.stderr, true)
})

test('bundled PDF processing keeps concurrency limits and releases slots after parser failure', async () => {
  const validate = await validator
  const pdf = textReceiptPdf()
  const pending = [validate(pdf, 'application/pdf'), validate(pdf, 'application/pdf')]
  await assert.rejects(validate(pdf, 'application/pdf'), error => error.status === 429)
  await Promise.all(pending)
  await assert.rejects(validate(Buffer.from('%PDF-1.7\nSynthetic malformed PDF\n%%EOF\n'), 'application/pdf'), error => error.status === 400)
  assert.equal((await validate(pdf, 'application/pdf')).mime, 'application/pdf')
})
