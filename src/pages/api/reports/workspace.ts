import { serverClient, nodeHeaders } from '@/lib/platform/server'
import { AiHttpError } from '@/lib/ai/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextApiRequest, NextApiResponse } from 'next'
import { createServerClient, serializeCookieHeader } from '@supabase/ssr'
import { z } from 'zod'
import { AccountType, Capability, Role } from '@/types/enums'
import { hasCapability } from '@/lib/capabilities'
import { loadWorkspaceReport, ReportLimitError, workspaceReportQuery } from '@/lib/workspace-report'

const profileSchema = z.object({ account_type:z.nativeEnum(AccountType),role:z.nativeEnum(Role),is_active:z.literal(true) })
export const config = { api: { bodyParser:false } }

export default async function handler(request:NextApiRequest,response:NextApiResponse) {
  response.setHeader('Cache-Control','private, no-store')
  response.setHeader('X-Content-Type-Options','nosniff')
  const fail = (status:number) => response.status(status).json({error:status === 401 ? 'Sign in to download reports.'
    : status === 413 ? 'This report exceeds the download limit. No partial file was generated.' : 'Could not download this report.'})
  if (request.method !== 'GET') { response.setHeader('Allow','GET'); return fail(405) }
  const query = workspaceReportQuery.safeParse(request.query)
  if (!query.success) return fail(400)
  try {
    const client = process.env.NEXT_PUBLIC_BACKEND === 'render'
      ? await serverClient(nodeHeaders(request.headers)) as unknown as SupabaseClient
      : createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
      cookies:{
        getAll:()=>Object.entries(request.cookies).map(([name,value])=>({name,value:value ?? ''})),
        setAll:entries=>{ response.setHeader('Set-Cookie',entries.map(({name,value,options})=>serializeCookieHeader(name,value,options))) },
      },
    })
    const {data:identity,error:authError}=await client.auth.getUser()
    if (authError || !identity.user) return fail(401)
    const profile = await client.from('users').select('account_type,role,is_active').eq('id',identity.user.id).maybeSingle()
    if (profile.error) return fail(503)
    const actor = profileSchema.safeParse(profile.data)
    if (!actor.success || !hasCapability(actor.data.account_type,actor.data.role,Capability.exportTaxDocuments)) return fail(403)
    const result = await loadWorkspaceReport(client,query.data)
    response.setHeader('Content-Type','text/csv; charset=utf-8')
    response.setHeader('Content-Disposition',`attachment; filename="${result.filename}"`)
    return response.status(200).send(result.csv)
  } catch (error) { return fail(error instanceof AiHttpError ? error.status : error instanceof ReportLimitError ? 413 : error instanceof z.ZodError ? 422 : 503) }
}
