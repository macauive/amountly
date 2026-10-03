import { serverClient, nodeHeaders } from '@/lib/platform/server'
import { AiHttpError } from '@/lib/ai/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import type { NextApiRequest, NextApiResponse } from 'next'
import { serializeCookieHeader } from '@supabase/ssr'
import { renderToBuffer } from '@react-pdf/renderer'
import { InvoicePDF } from '@/components/InvoicePDF'
import { mapInvoice } from '@/lib/invoice-records'
import { invoicePdfFilename } from '@/lib/invoice-document'

// This Node API uses the installed React runtime, matching react-pdf's reconciler.
// App Router's separately bundled React runtime is incompatible with this app's React 18 renderer.

const noStore = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
export default async function handler(request: NextApiRequest, response: NextApiResponse) {
  Object.entries(noStore).forEach(([name,value])=>response.setHeader(name,value))
  const failure = (status: number) => response.status(status).json({ error: status === 401 ? 'Sign in to download invoices.' : 'Could not download this invoice.' })
  if (request.method !== 'GET') { response.setHeader('Allow','GET'); return failure(405) }
  const { id } = request.query
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return failure(400)
  try {
    // Use the user's cookie session and ordinary public key. Every query below
    // is subject to the same RLS as the browser; no privileged client is used.
    const client = process.env.NEXT_PUBLIC_BACKEND === 'render'
      ? await serverClient(nodeHeaders(request.headers)) as unknown as SupabaseClient
      : createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll: () => Object.entries(request.cookies).map(([name,value])=>({name,value:value ?? ''})),
        setAll: entries => { response.setHeader('Set-Cookie',entries.map(({name,value,options})=>serializeCookieHeader(name,value,options))) },
      },
    })
    const { data: identity, error: authError } = await client.auth.getUser()
    if (authError || !identity.user) return failure(401)
    const { data: invoice, error } = await client.from('invoices')
      .select('*, client:clients(*), project:projects(*), line_items:invoice_line_items(*)').eq('id', id).maybeSingle()
    if (error) return failure(503)
    if (!invoice) return failure(404)
    // Bound document rendering for malformed legacy records as well as new ones.
    if (!Array.isArray(invoice.line_items) || invoice.line_items.length > 100
      || JSON.stringify(invoice).length > 250000) return failure(422)
    const payments = []
    for (let offset = 0; ; offset += 200) {
      const page = await client.from('invoice_payments').select('id,amount,reversal:invoice_payment_reversals(id)').eq('invoice_id',id).order('id').range(offset,offset+199)
      if (page.error) return failure(503)
      payments.push(...(page.data ?? []))
      if (!page.data || page.data.length < 200) break
    }
    const organization = invoice.organization_id
      ? await client.from('organizations').select('name,email,address,city,state,zip_code').eq('id',invoice.organization_id).maybeSingle()
      : { data: null, error: null }
    if (organization.error) return failure(503)
    const document = mapInvoice({ ...invoice, payments })
    const bytes = await renderToBuffer(InvoicePDF({ invoice: document, organization: organization.data }))
    response.setHeader('Content-Type','application/pdf')
    response.setHeader('Content-Disposition', `attachment; filename="${invoicePdfFilename(document.invoice_number)}"`)
    return response.status(200).send(bytes)
  } catch (error) { return failure(error instanceof AiHttpError ? error.status : 503) }
}
