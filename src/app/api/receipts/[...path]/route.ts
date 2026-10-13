import { createHash, randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { Pool } from 'pg'
import { z } from 'zod/v3'
import { requireIdentity, validateOrigin } from '@/lib/platform/server'
import { requiredSecret, usesRenderBackend } from '@/lib/platform/config'
import { AiHttpError } from '@/lib/ai/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
let pool: Pool | undefined
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }
const types: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }
const captureSchema = z.object({ id: z.string().uuid(), revision: z.string().regex(/^[1-9][0-9]{0,9}$/).refine(value => Number(value) <= 2147483647) })
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
    const capture = upload && (request.headers.has('x-capture-id') || request.headers.has('x-capture-revision'))
      ? captureSchema.parse({ id: request.headers.get('x-capture-id'), revision: request.headers.get('x-capture-revision') }) : null
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
      const guard = await connection.query('select amountly_files.storage_budget_ready() as ready')
      if (guard.rows[0]?.ready !== true) throw new AiHttpError(503, 'Receipt storage unavailable')
      let objectPath = `${identity.id}/${randomUUID()}.${types[type]}`
      let promoted = false
      if (capture) {
        await connection.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [identity.id])
        const result = await connection.query('select revision,file_sha256,content_type,receipt_path from amountly_files.capture_drafts where id=$1 and owner_id=$2 for update', [capture.id, identity.id])
        const row = result.rows[0]
        if (!row || row.revision !== Number(capture.revision)) throw new AiHttpError(409, 'Capture changed')
        // A replacement chosen after resuming is an ordinary new upload. Only
        // the exact kept original can be moved/reused without allocating bytes.
        if (row.content_type === type && row.file_sha256 === createHash('sha256').update(bytes!).digest('hex')) {
          if (row.receipt_path) { objectPath = row.receipt_path; promoted = true }
          else await connection.query('update amountly_files.capture_drafts set contents=null,receipt_path=$1 where id=$2 and owner_id=$3', [objectPath, capture.id, identity.id])
        }
      }
      if (!promoted) await connection.query('insert into amountly_files.receipts (path, owner_id, content_type, contents) values ($1,$2,$3,$4)', [objectPath, identity.id, type, bytes])
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
    const quota = typeof error === 'object' && error !== null && 'code' in error && error.code === 'PT413'
    return Response.json({ error: quota ? 'Receipt storage is full. Contact support before uploading more files.' : 'Could not access this receipt.' },
      { status: quota ? 413 : error instanceof AiHttpError ? error.status : error instanceof z.ZodError ? 400 : 503, headers })
  } finally { connection?.release() }
}
export const PUT = handle
export const GET = handle
