import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { Capability } from '@/types/enums'
import { hasCapability } from '@/lib/capabilities'
import { actorSchema, snapshotSchema, periodSchema, ReviewError, addDays, type Actor, type Period, type Snapshot } from '@/lib/financial-review/contracts'
import { calculateReview } from '@/lib/financial-review/calculate'

// Only server-authenticated clients may call this service. No owner IDs come from tool input.
export async function readActor(client: SupabaseClient): Promise<Actor> {
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) throw new ReviewError(401, 'Sign in to review your finances.')
  const result = await client.from('users').select('id,organization_id,account_type,role,is_active').eq('id', data.user.id).single()
  if (result.error) throw new ReviewError(503)
  const actor = actorSchema.safeParse(result.data)
  if (!actor.success || actor.data.id !== data.user.id || (actor.data.account_type === 'business' && !actor.data.organization_id)) throw new ReviewError(403)
  return actor.data
}

export async function loadReviewSnapshot(client: SupabaseClient, actorInput: Actor, periodInput: Period): Promise<Snapshot> {
  const actor = actorSchema.parse(actorInput), period = periodSchema.parse(periodInput)
  const can = (capability: Capability) => hasCapability(actor.account_type, actor.role, capability)
  async function pages(build: (offset: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = []
    for (let offset = 0; offset <= 2000; offset += 200) {
      const result = await build(offset)
      if (result.error || !Array.isArray(result.data)) throw new ReviewError(503)
      rows.push(...z.array(z.record(z.unknown())).max(200).parse(result.data))
      if (rows.length > 2000) throw new ReviewError(413, 'Too many records for one review. No partial totals were returned.')
      if (result.data.length < 200) return rows
    }
    throw new ReviewError(413)
  }
  let invoiceQuery = client.from('invoices').select('id,user_id,organization_id,invoice_number,total,currency,issue_date,due_date,status')
    .eq('currency', period.currency).in('status', ['SENT', 'OVERDUE'])
  invoiceQuery = actor.account_type === 'business' ? invoiceQuery.eq('organization_id', actor.organization_id).is('user_id', null)
    : invoiceQuery.eq('user_id', actor.id).is('organization_id', null)
  const invoices = can(Capability.viewInvoices) ? await pages(offset => invoiceQuery.order('id').range(offset, offset + 199)) : []
  const payments: Record<string, unknown>[] = []
  // Payment rows are bounded independently, and RLS checks their invoice parent.
  for (let offset = 0; offset < invoices.length; offset += 100) {
    payments.push(...await pages(page => client.from('invoice_payments').select('id,invoice_id,amount,reversal:invoice_payment_reversals(id)').in('invoice_id', invoices.slice(offset, offset + 100).map(i => i.id)).order('id').range(page, page + 199)))
    if (payments.length > 2000) throw new ReviewError(413)
  }
  let bills: Record<string, unknown>[] = []
  if (actor.account_type === 'personal' && can(Capability.viewBills)) bills = (await pages(offset => client.from('bills')
    .select('id,user_id,name,amount,currency,due_date,status').eq('user_id', actor.id).eq('currency', period.currency).in('status', ['upcoming', 'due', 'overdue']).order('id').range(offset, offset + 199)))
    .map(b => ({ ...b, organization_id: null, kind: 'bills' }))
  if (can(Capability.viewAccountsPayable)) {
    let query = client.from('vendor_bills').select('id,user_id,organization_id,bill_number,total,currency,due_date,status').eq('currency', period.currency).in('status', ['upcoming', 'due', 'overdue'])
    query = actor.account_type === 'business' ? query.eq('organization_id', actor.organization_id) : query.eq('user_id', actor.id).is('organization_id', null)
    bills = (await pages(offset => query.order('id').range(offset, offset + 199))).map(b => ({ ...b, name: b.bill_number, amount: b.total, kind: 'vendor_bills' }))
  }
  let expenseQuery = client.from('expenses').select('id,user_id,organization_id,description,amount,currency,expense_date,category,status,receipt_path,receipt_url,archived_at')
    .eq('currency', period.currency).is('archived_at', null).neq('status', 'REJECTED').gte('expense_date', addDays(period.start, -90)).lt('expense_date', addDays(period.end, 1))
  expenseQuery = actor.account_type === 'business' ? expenseQuery.eq('organization_id', actor.organization_id) : expenseQuery.eq('user_id', actor.id).is('organization_id', null)
  if (!can(Capability.viewTeamExpenses)) expenseQuery = expenseQuery.eq('user_id', actor.id)
  const expenses = can(Capability.viewOwnExpenses) ? await pages(offset => expenseQuery.order('id').range(offset, offset + 199)) : []
  const snapshot = snapshotSchema.parse({ invoices, payments, bills, expenses })
  // Defense in depth if a query or future RLS policy accidentally broadens.
  for (const row of [...snapshot.invoices, ...snapshot.bills, ...snapshot.expenses]) {
    const belongs = actor.account_type === 'business' ? row.organization_id === actor.organization_id
      : row.organization_id === null && row.user_id === actor.id
    if (!belongs) throw new ReviewError(403)
  }
  if (!can(Capability.viewTeamExpenses) && snapshot.expenses.some(e => e.user_id !== actor.id)) throw new ReviewError(403)
  const ids = new Set(snapshot.invoices.map(i => i.id))
  if (snapshot.payments.some(p => !ids.has(p.invoice_id))) throw new ReviewError(403)
  return snapshot
}
export async function reviewForClient(client: SupabaseClient, period: Period, asOf: string) {
  const actor = await readActor(client)
  return calculateReview(await loadReviewSnapshot(client, actor, period), period, asOf)
}
export function safeReviewFailure(error: unknown) {
  if (error instanceof ReviewError) return { status: error.status, message: error.message }
  if (error instanceof z.ZodError) return { status: 422, message: 'Some financial records could not be validated. No partial review was returned.' }
  return { status: 503, message: 'Could not load the financial review. Try again.' }
}

export const recordQuerySchema = z.object({ kind: z.enum(['invoices', 'bills', 'vendor_bills', 'expenses']), id: z.string().uuid() }).strict()
export function summarizeRecord(kind: z.infer<typeof recordQuerySchema>['kind'], input: unknown) {
  const schema = kind === 'invoices' ? snapshotSchema.shape.invoices.element
    : kind === 'expenses' ? snapshotSchema.shape.expenses.element : snapshotSchema.shape.bills.element
  const row = schema.parse(input)
  return { id: row.id, kind, label: ('invoice_number' in row ? row.invoice_number : 'name' in row ? row.name : row.description || 'Expense').slice(0, 160),
    amount: 'total' in row ? row.total : row.amount, currency: row.currency, status: row.status,
    date: 'expense_date' in row ? row.expense_date : row.due_date,
    receiptAttached: 'receipt_path' in row ? !!(row.receipt_path?.trim() || row.receipt_url?.trim()) : undefined }
}
export async function readSourceRecord(client: SupabaseClient, input: unknown) {
  const query = recordQuerySchema.parse(input), actor = await readActor(client)
  const can = (cap: Capability) => hasCapability(actor.account_type, actor.role, cap)
  const permission = query.kind === 'invoices' ? can(Capability.viewInvoices) : query.kind === 'bills' ? actor.account_type === 'personal' && can(Capability.viewBills)
    : query.kind === 'vendor_bills' ? can(Capability.viewAccountsPayable) : can(Capability.viewOwnExpenses)
  if (!permission) throw new ReviewError(403)
  const columns = {
    invoices: 'id,user_id,organization_id,invoice_number,total,currency,issue_date,due_date,status',
    bills: 'id,user_id,name,amount,currency,due_date,status',
    vendor_bills: 'id,user_id,organization_id,bill_number,total,currency,due_date,status',
    expenses: 'id,user_id,organization_id,description,amount,currency,expense_date,category,status,receipt_path,receipt_url,archived_at',
  }
  let read = client.from(query.kind).select(columns[query.kind]).eq('id', query.id)
  if (query.kind === 'bills') read = read.eq('user_id', actor.id)
  else if (actor.account_type === 'business') read = read.eq('organization_id', actor.organization_id)
  else read = read.eq('user_id', actor.id).is('organization_id', null)
  if (query.kind === 'expenses') {
    read = read.is('archived_at', null)
    if (!can(Capability.viewTeamExpenses)) read = read.eq('user_id', actor.id)
  }
  const result = await read.single()
  if (result.error || !result.data) throw new ReviewError(404, 'This record is unavailable or outside your access.')
  const raw = z.record(z.unknown()).parse(result.data)
  if (raw.id !== query.id || (actor.account_type === 'business' ? raw.organization_id !== actor.organization_id
    : raw.user_id !== actor.id || (query.kind !== 'bills' && raw.organization_id !== null))) throw new ReviewError(403)
  if (query.kind === 'expenses' && !can(Capability.viewTeamExpenses) && raw.user_id !== actor.id) throw new ReviewError(403)
  const normalized = query.kind === 'bills' ? { ...raw, organization_id: null, kind: 'bills' }
    : query.kind === 'vendor_bills' ? { ...raw, name: raw.bill_number, amount: raw.total, kind: 'vendor_bills' } : raw
  return summarizeRecord(query.kind, normalized)
}
