import { AiHttpError } from '@/lib/ai/server'

// Bound the stream itself, including uploads without a trustworthy Content-Length.
export async function readBoundedBytes(request: Request, maxBytes: number, timeoutMs = 10000): Promise<Uint8Array> {
  if (request.signal.aborted) throw new AiHttpError(408, 'Receipt extraction cancelled.')
  const length = request.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw new AiHttpError(413, 'Receipt must be under 10 MB')
  }
  if (!request.body) throw new AiHttpError(400, 'Choose a nonempty receipt file')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let interrupt: (reason: AiHttpError) => void = () => {}
  const interrupted = new Promise<never>((_, reject) => { interrupt = reject })
  const cancel = () => {
    interrupt(new AiHttpError(408, 'Receipt extraction cancelled.'))
    void reader.cancel().catch(() => {})
  }
  const timer = setTimeout(() => {
    interrupt(new AiHttpError(408, 'Receipt upload timed out. Try again.'))
    void reader.cancel().catch(() => {})
  }, timeoutMs)
  request.signal.addEventListener('abort', cancel, { once: true })
  if (request.signal.aborted) cancel()
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), interrupted])
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        void reader.cancel().catch(() => {})
        throw new AiHttpError(413, 'Receipt must be under 10 MB')
      }
      chunks.push(value)
    }
    if (!size) throw new AiHttpError(400, 'Choose a nonempty receipt file')
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return bytes
  } finally {
    clearTimeout(timer)
    request.signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

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
