import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import sharp from 'sharp'
import { AiHttpError } from './server'

const maxBytes = 10 * 1024 * 1024
const maxPixels = 25_000_000
const imageFormats: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}
const supportedTypes = new Set([...Object.values(imageFormats), 'application/pdf'])
let activeChecks = 0

function invalidPdf() {
  return new AiHttpError(400, 'Choose an unencrypted, readable PDF with at most 5 pages.')
}

async function validatePdf(bytes: Buffer) {
  if (!bytes.subarray(0, 8).toString('ascii').startsWith('%PDF-')
    || !bytes.subarray(Math.max(0, bytes.length - 1024)).toString('latin1').includes('%%EOF')) {
    throw invalidPdf()
  }
  const valid = await new Promise<boolean>((resolve) => {
    const worker = new Worker(join(process.cwd(), 'scripts/receipt-pdf-worker.mjs'), {
      workerData: Uint8Array.from(bytes),
      resourceLimits: { maxOldGenerationSizeMb: 128 },
      execArgv: [],
      stdout: true,
      stderr: true,
    })
    // Parser diagnostics may include document text. Drain them without logging.
    worker.stdout?.resume()
    worker.stderr?.resume()
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // Keep the processing slot until the isolated parser actually exits.
      void worker.terminate().then(() => resolve(ok), () => resolve(false))
    }
    const timer = setTimeout(() => finish(false), 10_000)
    worker.once('message', (result) => finish(result === true))
    worker.once('error', () => finish(false))
    worker.once('exit', () => finish(false))
  }).catch(() => false)
  if (!valid) throw invalidPdf()
}

// Server-only boundary: decode and verify content before sending any file to AI.
// The returned image is a metadata-free, bounded derivative; PDFs stay original.
export async function validateReceiptFile(bytes: Buffer, declaredMime: string): Promise<{ data: Buffer; mime: string }> {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new AiHttpError(400, 'Choose a nonempty receipt file.')
  }
  if (bytes.length > maxBytes) throw new AiHttpError(413, 'Choose a receipt file under 10 MB.')
  const mime = declaredMime.split(';')[0].trim().toLowerCase()
  if (!supportedTypes.has(mime)) {
    throw new AiHttpError(415, 'Choose a JPEG, PNG, WebP, or PDF receipt.')
  }
  if (activeChecks >= 2) throw new AiHttpError(429, 'Receipt processing is busy. Try again shortly.')
  activeChecks++
  try {
    if (mime === 'application/pdf') {
      await validatePdf(bytes)
      return { data: bytes, mime }
    }
    try {
      // Restrict codec dispatch before Sharp's format detection can parse a
      // different format (for example SVG or TIFF sent as image/png).
      const expectedHeader = mime === 'image/jpeg'
        ? bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
        : mime === 'image/png'
          ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
          : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
      if (!expectedHeader) throw new Error('Invalid receipt image')
      const image = sharp(bytes, { animated: true, limitInputPixels: maxPixels, failOn: 'warning' })
      const metadata = await image.metadata()
      if (imageFormats[metadata.format ?? ''] !== mime
        || (metadata.pages ?? 1) !== 1
        || !metadata.width || !metadata.height
        || metadata.width * metadata.height > maxPixels) {
        throw new Error('Invalid receipt image')
      }
      // toBuffer performs a full decode, catching incomplete/corrupt image data.
      const data = await image.rotate()
        .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 90 })
        .toBuffer()
      if (!data.length || data.length > maxBytes) {
        throw new AiHttpError(413, 'Choose a smaller receipt image.')
      }
      return { data, mime: 'image/jpeg' }
    } catch (error) {
      if (error instanceof AiHttpError) throw error
      throw new AiHttpError(400, 'Choose a readable, single-frame receipt image under 25 megapixels.')
    }
  } finally {
    activeChecks--
  }
}
