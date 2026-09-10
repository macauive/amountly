import { AiHttpError } from '@/lib/ai/server'

// Limit bytes while reading, before parsing JSON; Content-Length alone is untrusted.
export async function readBoundedJson(message: Request | Response, maxBytes: number): Promise<unknown> {
  const length = message.headers.get('content-length')
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw new AiHttpError(413, 'Input is too large')
  }
  if (!message.body) throw new AiHttpError(400, 'Invalid JSON input')
  const reader = message.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new AiHttpError(413, 'Input is too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new AiHttpError(400, 'Invalid JSON input')
  }
}
