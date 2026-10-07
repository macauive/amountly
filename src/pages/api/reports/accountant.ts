import { Buffer } from 'node:buffer'
import type { NextApiRequest, NextApiResponse } from 'next'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerClient, serializeCookieHeader } from '@supabase/ssr'
import { z } from 'zod/v3'
import { AccountType, Capability, Role } from '@/types/enums'
import { hasCapability } from '@/lib/capabilities'
import { nodeHeaders, requireIdentity, serverClient, validateOrigin } from '@/lib/platform/server'
import { AiHttpError } from '@/lib/ai/server'
import { loadWorkspaceReport, ReportLimitError } from '@/lib/workspace-report'
import { accountantPacketPeriod, accountantPacketQuery, buildAccountantPacket, PacketIntegrityError, PacketLimitError } from '@/lib/accountant-packet'
import { withReceiptReader } from '@/lib/receipt-export'

export const config = {api:{bodyParser:false}}
const profileSchema = z.object({account_type:z.literal(AccountType.freelancer),role:z.nativeEnum(Role),is_active:z.literal(true),organization_id:z.null()})
// One bounded packet at a time per application process keeps memory predictable.
let exporting = false

async function sendPacket(response:NextApiResponse,bytes:Uint8Array) {
  let settled = false
  let timer:ReturnType<typeof setTimeout>|undefined
  let complete = () => {}
  const finished = new Promise<void>(resolve=>{
    complete = () => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      response.off('finish',complete)
      response.off('close',complete)
      resolve()
    }
    response.once('finish',complete)
    response.once('close',complete)
    timer = setTimeout(()=>{response.destroy();complete()},30000)
  })
  try {
    // Keep the export slot until the socket has released its queued buffer.
    // Reuse the ZIP's allocation rather than copying the entire archive.
    response.status(200).send(Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength))
    if (response.writableFinished || response.destroyed) complete()
    await finished
  } finally { complete() }
}

export default async function handler(request:NextApiRequest,response:NextApiResponse) {
  response.setHeader('Cache-Control','private, no-store')
  response.setHeader('X-Content-Type-Options','nosniff')
  response.setHeader('Content-Security-Policy',"default-src 'none'; sandbox")
  const fail = (status:number) => response.status(status).json({error:
    status === 401 ? 'Sign in to download an accountant packet.' : status === 413 ? 'This packet exceeds the download limit. Choose a shorter date range. No partial file was generated.'
    : status === 429 ? 'Another packet is being prepared. Try again shortly.' : 'Could not download this accountant packet.'})
  if (request.method !== 'GET') {response.setHeader('Allow','GET');return fail(405)}
  const query = accountantPacketQuery.safeParse(request.query)
  if (!query.success) return fail(400)
  let acquired = false
  try {
    const headers = nodeHeaders(request.headers)
    validateOrigin(headers)
    const render = process.env.NEXT_PUBLIC_BACKEND === 'render'
    const client = render ? await serverClient(headers) as unknown as SupabaseClient
      : createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
        global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(10000),cache:'no-store'})},
        cookies:{getAll:()=>Object.entries(request.cookies).map(([name,value])=>({name,value:value??''})),
          setAll:entries=>{response.setHeader('Set-Cookie',entries.map(({name,value,options})=>serializeCookieHeader(name,value,options)))}},
      })
    async function authorized() {
      const {data,error} = await client.auth.getUser()
      if (error || !data.user) throw new AiHttpError(401,'Sign in to continue')
      const profile = await client.from('users').select('account_type,role,is_active,organization_id').eq('id',data.user.id).maybeSingle()
      if (profile.error) throw new Error('Profile unavailable')
      const actor = profileSchema.safeParse(profile.data)
      if (!actor.success || !hasCapability(actor.data.account_type,actor.data.role,Capability.exportTaxDocuments)) throw new AiHttpError(403,'Account unavailable')
      return {id:data.user.id,email:data.user.email ?? ''}
    }
    const identity = await authorized()
    if (exporting) {response.setHeader('Retry-After','5');return fail(429)}
    exporting = true; acquired = true
    const deadline = Date.now()+45000
    const report = await loadWorkspaceReport(client,query.data,{ownerId:identity.id,period:accountantPacketPeriod(query.data),deadline})
    const result = await withReceiptReader(identity,client,deadline,reader=>buildAccountantPacket({
      ...report,ownerId:identity.id,currency:query.data.currency,basis:query.data.basis,
    },reader,{storageOrigin:process.env.NEXT_PUBLIC_SUPABASE_URL}))
    // Recheck a revoked session/disabled profile before disclosing the archive.
    if (render && (await requireIdentity(headers)).id !== identity.id) throw new AiHttpError(401,'Sign in to continue')
    if ((await authorized()).id !== identity.id) throw new AiHttpError(401,'Sign in to continue')
    if (Date.now() > deadline || request.aborted) throw new Error('Packet unavailable')
    response.setHeader('Content-Type','application/zip')
    response.setHeader('Content-Disposition',`attachment; filename="${result.filename}"`)
    await sendPacket(response,result.bytes)
    return response
  } catch (error) {
    if (response.headersSent || response.destroyed) {
      if (!response.destroyed) response.destroy()
      return response
    }
    response.removeHeader('Content-Disposition')
    response.removeHeader('Content-Type')
    return fail(error instanceof AiHttpError ? error.status : error instanceof ReportLimitError || error instanceof PacketLimitError ? 413
      : error instanceof z.ZodError || error instanceof PacketIntegrityError ? 422 : 503)
  } finally { if (acquired) exporting = false }
}
