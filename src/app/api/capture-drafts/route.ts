import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { Pool } from 'pg'
import { z } from 'zod/v3'
import { requireIdentity, validateOrigin } from '@/lib/platform/server'
import { requiredSecret, usesRenderBackend } from '@/lib/platform/config'
import { AiHttpError } from '@/lib/ai/server'
import { readBoundedBytes, readBoundedJson } from '@/lib/http'
import { validateReceiptFile } from '@/lib/ai/receipt-file'
import { captureDraftSchema, captureWriteSchema } from '@/lib/capture-drafts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
let pool: Pool | undefined
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
const columns = 'id,revision,updated_at,payload,file_name,content_type'
const querySchema = z.object({ id: z.string().uuid().optional(), file: z.literal('1').optional(), revision: z.string().regex(/^[1-9][0-9]{0,9}$/).refine(value=>Number(value)<=2147483647).optional() }).strict()
const deleteSchema = z.object({ id: z.string().uuid(), revision: z.number().int().positive() }).strict()
const normalize = (row: Record<string, unknown>) => captureDraftSchema.parse({ ...row, updated_at: (row.updated_at as Date).toISOString() })

async function handle(request: Request) {
  if (!usesRenderBackend) return Response.json({ error: 'Not found' }, { status: 404, headers })
  let tx
  try {
    validateOrigin(request.headers, request.method !== 'GET')
    const identity = await requireIdentity(request.headers)
    const params = new URL(request.url).searchParams
    if ([...params.keys()].some(key => params.getAll(key).length !== 1)) throw new AiHttpError(400, 'Invalid capture query')
    const query = querySchema.parse(Object.fromEntries(params))
    if ((query.revision && !query.file) || (query.file && (!query.id || !query.revision))) throw new AiHttpError(400, 'Choose a capture')
    if (request.method !== 'GET' && params.size) throw new AiHttpError(400, 'Unexpected query')

    let write, contents: Buffer | null = null, fileName: string | null = null, type: string | null = null
    if (request.method === 'PUT') {
      if (!request.headers.get('content-type')?.startsWith('multipart/form-data; boundary=')) throw new AiHttpError(415, 'Expected capture form')
      const bytes = await readBoundedBytes(request, 10 * 1024 * 1024 + 65536)
      const form = await new Response(new Uint8Array(bytes), { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData()
      if ([...form.keys()].some(key => !['metadata','file'].includes(key) || form.getAll(key).length !== 1)) throw new AiHttpError(400, 'Unexpected capture fields')
      const metadata = form.get('metadata')
      if (typeof metadata !== 'string' || Buffer.byteLength(metadata) > 32768) throw new AiHttpError(400, 'Invalid capture')
      write = captureWriteSchema.parse(JSON.parse(metadata))
      const file = form.get('file')
      if (file !== null) {
        if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024) throw new AiHttpError(413, 'Invalid receipt size')
        contents = Buffer.from(await file.arrayBuffer())
        await validateReceiptFile(contents, file.type)
        fileName = file.name.normalize('NFKC').replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 200) || 'receipt'
        type = file.type
      }
      if (write.payload.extraction && (!contents || write.payload.extraction.document_type !== 'receipt')) throw new AiHttpError(400, 'Invalid receipt proposal')
    }
    const remove = request.method === 'DELETE' ? deleteSchema.parse(await readBoundedJson(request, 1024)) : null
    pool ??= new Pool({ connectionString: requiredSecret('DATA_DATABASE_URL'), max: 2, connectionTimeoutMillis: 10000 })
    tx = await pool.connect()
    await tx.query('begin')
    await tx.query('set local role authenticated')
    await tx.query("select set_config('request.jwt.claims',$1,true), set_config('statement_timeout','10000',true)", [JSON.stringify({ sub: identity.id, role: 'authenticated' })])
    let response: Response
    if (request.method === 'GET') {
      if (query.file) {
        const result = await tx.query('select contents,content_type from amountly_files.capture_drafts where id=$1 and owner_id=$2 and revision=$3', [query.id, identity.id, query.revision])
        if (!result.rows[0]?.contents) throw new AiHttpError(404, 'Capture unavailable')
        response = new Response(new Uint8Array(result.rows[0].contents), { headers: { ...headers, 'Content-Type': result.rows[0].content_type, 'Content-Disposition': 'attachment; filename="receipt"', 'Content-Security-Policy': "default-src 'none'; sandbox" } })
      } else {
        const result = await tx.query(`select ${columns} from amountly_files.capture_drafts where owner_id=$1${query.id?' and id=$2':''} order by updated_at desc limit 10`, query.id?[identity.id,query.id]:[identity.id])
        response = Response.json(result.rows.map(normalize), { headers })
      }
    } else if (write) {
      // Serialize this owner's finite capture set, including simultaneous creates.
      await tx.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [identity.id])
      const digest = contents ? createHash('sha256').update(contents).digest('hex') : null
      const existing = await tx.query('select revision,payload,file_sha256,file_name,content_type from amountly_files.capture_drafts where id=$1 and owner_id=$2 for update', [write.id, identity.id])
      let revision = write.revision
      if (existing.rows[0]) {
        const row = existing.rows[0]
        const same = await tx.query('select $1::jsonb=$2::jsonb as same', [row.payload, write.payload])
        // The identical original request can safely recover a lost save response.
        if (row.revision === revision + 1 && same.rows[0].same && row.file_sha256 === digest && row.file_name === fileName && row.content_type === type) revision = row.revision
        else if (row.revision !== revision) throw new AiHttpError(409, 'Capture changed')
        else await tx.query('update amountly_files.capture_drafts set payload=$1,contents=$2,file_name=$3,content_type=$4,file_sha256=$5,revision=revision+1,updated_at=now() where id=$6 and owner_id=$7', [write.payload, contents, fileName, type, digest, write.id, identity.id])
      } else {
        if (revision !== 0) throw new AiHttpError(409, 'Capture unavailable')
        const count = await tx.query('select count(*)::int as count from amountly_files.capture_drafts where owner_id=$1', [identity.id])
        if (count.rows[0].count >= 10) throw new AiHttpError(413, 'Capture storage full')
        await tx.query('insert into amountly_files.capture_drafts(id,owner_id,payload,contents,file_name,content_type,file_sha256) values($1,$2,$3,$4,$5,$6,$7)', [write.id, identity.id, write.payload, contents, fileName, type, digest])
      }
      const result = await tx.query(`select ${columns} from amountly_files.capture_drafts where id=$1 and owner_id=$2`, [write.id, identity.id])
      response = Response.json(normalize(result.rows[0]), { headers })
    } else if (remove) {
      const result = await tx.query('delete from amountly_files.capture_drafts where id=$1 and owner_id=$2 and revision=$3 returning id', [remove.id, identity.id, remove.revision])
      if (!result.rowCount) throw new AiHttpError(409, 'Capture changed')
      response = new Response(null, { status: 204, headers })
    } else throw new AiHttpError(405, 'Method not allowed')
    await tx.query('commit')
    return response
  } catch (error) {
    if (tx) await tx.query('rollback').catch(() => {})
    const status = error instanceof AiHttpError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503
    return Response.json({ error: 'Could not access this capture.' }, { status, headers })
  } finally { tx?.release() }
}
export const GET = handle
export const PUT = handle
export const DELETE = handle
