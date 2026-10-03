import { usesRenderBackend } from '@/lib/platform/config'
import { identityToken, privateDataOrigin, requireIdentity, validateOrigin } from '@/lib/platform/server'
import { readBoundedJson } from '@/lib/http'
import { AiHttpError } from '@/lib/ai/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const tables = new Set(['accounts', 'bills', 'clients', 'employees', 'expenses', 'inventory_items',
  'invoice_payments', 'invoices', 'journal_entries', 'journal_entry_lines', 'organizations', 'pay_stubs',
  'payroll_runs', 'projects', 'purchase_orders', 'record_events', 'tasks', 'tax_filings', 'time_entries',
  'users', 'vendor_bills', 'vendors', 'workspace_contacts'])
const exportTables = new Set(['invoice_line_items', 'invoice_payment_reversals'])
const commands = new Set(['bill_action', 'consume_ai_quota', 'create_invoice_from_time', 'create_money_record',
  'invoice_action', 'purchase_order_action', 'record_invoice_payment', 'reverse_invoice_payment',
  'review_legacy_payment', 'review_work_record', 'save_invoice', 'save_purchase_order', 'save_vendor_bill',
  'seed_quarterly_estimates', 'set_own_account_type', 'set_own_preferences', 'vendor_bill_action'])
const responseHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }

export async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  if (!usesRenderBackend) return Response.json({ message: 'Not found' }, { status: 404, headers: responseHeaders })
  try {
    const parts = (await context.params).path
    const rpc = parts.length === 2 && parts[0] === 'rpc' && commands.has(parts[1])
    const readOnly = parts.length === 1 && exportTables.has(parts[0])
    if (!(parts.length === 1 && tables.has(parts[0])) && !readOnly && !rpc) throw new AiHttpError(404, 'Not found')
    if (readOnly && !['GET', 'HEAD'].includes(request.method)) throw new AiHttpError(405, 'Method not allowed')
    if (rpc && request.method !== 'POST') throw new AiHttpError(405, 'Method not allowed')
    const mutating = !['GET', 'HEAD'].includes(request.method)
    validateOrigin(request.headers, mutating)
    const identity = await requireIdentity(request.headers)
    const url = new URL(request.url)
    if (url.search.length > 8192) throw new AiHttpError(413, 'Query too large')
    const headers = new Headers({ Authorization: `Bearer ${await identityToken(identity)}` })
    // Only query formatting headers cross this boundary. No caller identity,
    // role, schema, cookies, Host or forwarded headers reach PostgREST.
    for (const name of ['accept', 'prefer', 'range', 'range-unit']) {
      const value = request.headers.get(name)
      if (value && value.length <= 1024) headers.set(name, value)
    }
    let body: string | undefined
    if (mutating && request.method !== 'DELETE') {
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new AiHttpError(415, 'Expected JSON')
      body = JSON.stringify(await readBoundedJson(request, 262144))
      headers.set('Content-Type', 'application/json')
    }
    const upstream = await fetch(`${privateDataOrigin}/${parts.join('/')}${url.search}`, {
      method: request.method, headers, body, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
    })
    const outputHeaders = new Headers(responseHeaders)
    for (const name of ['content-type', 'content-range', 'preference-applied']) {
      const value = upstream.headers.get(name)
      if (value) outputHeaders.set(name, value)
    }
    if (request.method === 'HEAD' || upstream.status === 204) return new Response(null, { status: upstream.status, headers: outputHeaders })
    const data = await readBoundedJson(upstream, 4 * 1024 * 1024)
    if (!upstream.ok) {
      const code = data && typeof data === 'object' && 'code' in data && typeof data.code === 'string'
        && /^[A-Z0-9]{5,12}$/.test(data.code) ? data.code : 'REQUEST_FAILED'
      return Response.json({ code, message: 'Could not complete this request.', details: null, hint: null }, { status: upstream.status, headers: outputHeaders })
    }
    return Response.json(data, { status: upstream.status, headers: outputHeaders })
  } catch (error) {
    return Response.json({ code: 'REQUEST_FAILED', message: 'Could not complete this request.' },
      { status: error instanceof AiHttpError ? error.status : 503, headers: responseHeaders })
  }
}
export const GET = handle
export const HEAD = handle
export const POST = handle
export const PATCH = handle
export const DELETE = handle
