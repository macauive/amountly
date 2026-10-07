import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { requireIdentity, validateOrigin } from '@/lib/platform/server'
import { requiredSecret, usesRenderBackend } from '@/lib/platform/config'
import { AiHttpError } from '@/lib/ai/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
let pool: Pool | undefined
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }
const types: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }
function matches(bytes: Buffer, type: string) {
  if (type === 'application/pdf') return bytes.subarray(0, 5).toString() === '%PDF-'
  if (type === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  return bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP'
}
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  if (!usesRenderBackend) return Response.json({ error: 'Not found' }, { status: 404, headers })
  let connection
  try {
    validateOrigin(request.headers, request.method === 'PUT')
    const identity = await requireIdentity(request.headers)
    const path = (await context.params).path.join('/')
    const upload = request.method === 'PUT' && path === 'upload'
    if (!upload && (request.method !== 'GET' || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.test(path))) throw new AiHttpError(404, 'Not found')
    let bytes: Buffer | undefined
    const type = request.headers.get('content-type') ?? ''
    if (upload) {
      if (!types[type]) throw new AiHttpError(415, 'Unsupported receipt type')
      const limit = 10 * 1024 * 1024
      if (!request.body || Number(request.headers.get('content-length') ?? 0) > limit) throw new AiHttpError(413, 'Receipt too large')
      const reader = request.body.getReader(), chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > limit) { await reader.cancel(); throw new AiHttpError(413, 'Receipt too large') }
          chunks.push(value)
        }
      } finally { reader.releaseLock() }
      bytes = Buffer.concat(chunks)
      if (!matches(bytes, type)) throw new AiHttpError(415, 'Invalid receipt file')
    }
    pool ??= new Pool({ connectionString: requiredSecret('DATA_DATABASE_URL'), max: 2, connectionTimeoutMillis: 10000 })
    connection = await pool.connect()
    await connection.query('begin')
    await connection.query('set local role authenticated')
    await connection.query("select set_config('request.jwt.claims', $1, true), set_config('statement_timeout', '10000', true)", [JSON.stringify({ sub: identity.id, email: identity.email, role: 'authenticated' })])
    if (upload) {
      const objectPath = `${identity.id}/${randomUUID()}.${types[type]}`
      await connection.query('insert into amountly_files.receipts (path, owner_id, content_type, contents) values ($1,$2,$3,$4)', [objectPath, identity.id, type, bytes])
      await connection.query('commit')
      return Response.json({ path: objectPath }, { status: 201, headers })
    }
    const result = await connection.query('select content_type, contents from amountly_files.receipts where path=$1', [path])
    await connection.query('commit')
    if (!result.rows[0]) throw new AiHttpError(404, 'Receipt unavailable')
    return new Response(new Uint8Array(result.rows[0].contents), { headers: { ...headers, 'Content-Type': result.rows[0].content_type,
      'Content-Disposition': `attachment; filename="receipt.${path.split('.').pop()}"` } })
  } catch (error) {
    if (connection) await connection.query('rollback').catch(() => {})
    return Response.json({ error: 'Could not access this receipt.' }, { status: error instanceof AiHttpError ? error.status : 503, headers })
  } finally { connection?.release() }
}
export const PUT = handle
export const GET = handle
