const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const sharp = require('sharp')
const appLoader = require('./load-app.cjs')

// Run the application's actual validator, preserving real decoders and workers.
function loadValidator(overrides = {}) {
  const filename = path.resolve('src/lib/ai/receipt-file.ts')
  const server = appLoader()('src/lib/ai/server.ts')
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, {
    module, exports: module.exports,
    require: name => name === './server' ? server : Object.hasOwn(overrides, name) ? overrides[name] : require(name),
    Buffer, process, setTimeout, clearTimeout,
  }, { filename })
  return module.exports.validateReceiptFile
}

const validate = loadValidator()
const status = expected => error => error.status === expected

// Small synthetic PDF with exact offsets, selectable text, and page streams.
function receiptPdf(pageCount = 1, options = {}) {
  const fontId = 3 + pageCount * 2
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({ length: pageCount }, (_, n) => `${3 + n * 2} 0 R`).join(' ')}] >>`,
  ]
  for (let page = 0; page < pageCount; page++) {
    const stream = `BT /F1 12 Tf 72 720 Td (Synthetic receipt ${page + 1} Total 12.00) Tj ET`
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${4 + page * 2} 0 R >>`)
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  if (options.brokenLastPage) objects[pageCount * 2] = 'null'
  if (options.encrypted) {
    objects.push('<< /Filter /Standard /V 1 /R 2 /Length 40 /O <0000000000000000000000000000000000000000000000000000000000000000> /U <0000000000000000000000000000000000000000000000000000000000000000> /P -4 >>')
  }
  let source = '%PDF-1.7\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source))
    source += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(source)
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  source += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${options.encrypted ? ` /Encrypt ${objects.length} 0 R /ID [<00000000000000000000000000000000><00000000000000000000000000000000>]` : ''} >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(source)
}

async function image(format = 'png', width = 12, height = 12) {
  return await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })[format]().toBuffer()
}

test('receipt validator rejects empty, oversized, and unsupported uploads before parsing', async () => {
  await assert.rejects(validate(Buffer.alloc(0), 'image/png'), status(400))
  await assert.rejects(validate(Buffer.alloc(10 * 1024 * 1024 + 1), 'image/png'), status(413))
  await assert.rejects(validate(Buffer.from('synthetic'), 'image/svg+xml'), status(415))
  await assert.rejects(validate(Buffer.from('synthetic'), 'application/octet-stream'), status(415))
})

test('receipt validator verifies actual image formats and full decode', async () => {
  const png = await image()
  await assert.rejects(validate(png, 'image/jpeg'), status(400))
  await assert.rejects(validate(Buffer.from('not an image'), 'image/png'), status(400))
  await assert.rejects(validate(png.subarray(0, png.length - 20), 'image/png'), status(400))
  await assert.rejects(validate(receiptPdf(), 'image/png'), status(400))
})

test('spoofed SVG and TIFF receipt types never reach the native image decoder', async () => {
  let decodes = 0
  const guarded = loadValidator({ sharp: () => { decodes++; throw Error('Decoder must not receive unsupported content') } })
  for (const input of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), Buffer.from([0x49, 0x49, 0x2a, 0x00])]) {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
      await assert.rejects(guarded(input, mime), status(400))
    }
  }
  assert.equal(decodes, 0)
})

test('receipt images normalize orientation, bound dimensions, and remove metadata', async () => {
  for (const format of ['png', 'jpeg', 'webp']) {
    const input = await image(format)
    const result = await validate(input, format === 'jpeg' ? 'image/jpeg' : `image/${format}`)
    assert.equal(result.mime, 'image/jpeg')
    const metadata = await sharp(result.data).metadata()
    assert.equal(metadata.format, 'jpeg')
    assert.equal(metadata.width, 12)
    assert.equal(metadata.height, 12)
    assert.equal(metadata.exif, undefined)
    assert.equal(metadata.icc, undefined)
  }
  const input = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#fff' } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer()
  const result = await validate(input, ' IMAGE/JPEG; charset=binary ')
  const metadata = await sharp(result.data).metadata()
  assert.equal(metadata.width, 1024)
  assert.equal(metadata.height, 2048)
  assert.equal(metadata.orientation, undefined)
  assert.equal(metadata.exif, undefined)
  assert.equal(metadata.icc, undefined)
})

test('receipt validator rejects excessive image pixels and animated files', async () => {
  await assert.rejects(validate(await image('png', 5001, 5000), 'image/png'), status(400))
  const frames = Buffer.alloc(4 * 2 * 3, 255)
  frames.fill(0, 4 * 3)
  const animated = await sharp(frames, {
    raw: { width: 4, height: 2, channels: 3, pageHeight: 1 },
  }).webp({ loop: 0, delay: [100, 100] }).toBuffer()
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2)
  await assert.rejects(validate(animated, 'image/webp'), status(400))
})

test('receipt validator accepts readable one-to-five-page PDFs and preserves original bytes', async () => {
  for (const pageCount of [1, 5]) {
    const input = receiptPdf(pageCount)
    const result = await validate(input, 'application/pdf')
    assert.equal(result.mime, 'application/pdf')
    assert.deepEqual(result.data, input)
  }
})

test('receipt validator rejects spoofed, malformed, encrypted, and excessive-page PDFs', async () => {
  const invalid = [
    await image(),
    Buffer.from('%PDF-1.7\nSynthetic invalid file\n%%EOF'),
    receiptPdf().subarray(0, 100),
    receiptPdf(6),
    receiptPdf(1, { encrypted: true }),
    receiptPdf(2, { brokenLastPage: true }),
  ]
  for (const [index, input] of invalid.entries()) {
    await assert.rejects(validate(input, 'application/pdf'), status(400), `invalid fixture ${index}`)
  }
})

test('receipt processing bounds concurrent decoding and releases slots after failures', async () => {
  const input = await image()
  const pending = [validate(input, 'image/png'), validate(input, 'image/png')]
  await assert.rejects(validate(input, 'image/png'), status(429))
  await Promise.all(pending)
  await assert.rejects(validate(Buffer.from('broken'), 'image/png'), status(400))
  assert.equal((await validate(input, 'image/png')).mime, 'image/jpeg')
})
