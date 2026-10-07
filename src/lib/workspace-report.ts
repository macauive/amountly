import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod/v3'
import { reportPeriod, workspacePeriodCsv } from '@/lib/reporting'

export const workspaceReportQuery = z.object({
  year: z.string().regex(/^(20\d{2}|2100)$/).transform(Number),
  month: z.string().regex(/^(?:[1-9]|1[0-2])$/).transform(Number),
  currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD']),
  basis: z.enum(['cash', 'accrual']),
}).strict()

export class ReportLimitError extends Error {}
const amount = z.union([z.number(), z.string().regex(/^-?\d+(?:\.\d+)?$/)]).pipe(z.coerce.number().finite().min(-1e12).max(1e12))
const date = z.string().max(40).refine(value => {
  const day = value.slice(0, 10)
  const parsed = new Date(value)
  return /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value) && !isNaN(parsed.getTime())
    && new Date(`${day}T00:00:00Z`).toISOString().slice(0,10) === day
}).transform(value => value.slice(0,10))
const invoice = z.object({ invoice_number:z.string().max(100),currency:z.string().length(3),status:z.enum(['SENT','PAID','OVERDUE']) })
const issued = invoice.extend({ id:z.string().uuid(),issue_date:date,total:amount })
const receipt = z.object({ id:z.string().uuid(),amount,paid_on:date,invoice,
  reversal:z.union([z.object({id:z.string().uuid()}),z.array(z.object({id:z.string().uuid()})).max(1)]).nullable() })
const expense = z.object({ id:z.string().uuid(),expense_date:date,amount,currency:z.string().length(3),
  description:z.string().max(10000).nullable(),merchant:z.string().max(500).nullable(),status:z.enum(['DRAFT','SUBMITTED','APPROVED','REIMBURSED']) })
export const expenseEvidenceSchema = expense.extend({
  user_id:z.string().uuid(), category:z.string().max(100),
  receipt_path:z.string().max(200).nullable(), receipt_url:z.string().max(2048).nullable(),
  reviewed_at:z.string().datetime({offset:true}).nullable(),
})
export type ExpenseEvidence = z.infer<typeof expenseEvidenceSchema>
export type ReportRow = { id:string; date:string; type:string; name:string; amount:number; status:string }
export type ReportScope = { ownerId:string; period:ReturnType<typeof reportPeriod>; deadline?:number }

// Caller supplies a cookie-authenticated, non-privileged client. Every read is
// governed by RLS; no ownership identifier is accepted from the URL.
export async function loadWorkspaceReport(client: SupabaseClient, query: z.infer<typeof workspaceReportQuery>, scope?:ReportScope) {
  const period = scope?.period ?? reportPeriod(query.year,query.month)
  const rows: ReportRow[] = []
  const expenses:ExpenseEvidence[] = []
  if (scope) z.string().uuid().parse(scope.ownerId)
  function checkScope(owner:string, day:string, currency:string) {
    if (scope && (owner !== scope.ownerId || day < period.start || day >= period.endExclusive || currency !== query.currency)) throw new Error('Report scope mismatch')
  }
  let estimatedBytes = 0
  function add(row: typeof rows[number]) {
    estimatedBytes += new TextEncoder().encode(row.name).byteLength * 2 + 256
    if (estimatedBytes > 2_000_000) throw new ReportLimitError()
    rows.push(row)
  }
  const pageSize = 200
  const maxRecords = 10000
  async function pages<T>(build: (offset:number) => PromiseLike<{data:unknown;error:unknown}>, schema:z.ZodType<T,z.ZodTypeDef,unknown>, collect:(row:T)=>void) {
    for (let offset=0; ; offset+=pageSize) {
      if (scope?.deadline && Date.now() > scope.deadline) throw new Error('Report timed out')
      const page = await build(offset)
      if (page.error) throw new Error('Report read failed')
      const records = z.array(schema).max(pageSize).parse(page.data)
      if (offset + records.length > maxRecords) throw new ReportLimitError()
      records.forEach(collect)
      if (records.length < pageSize) return
    }
  }
  if (query.basis === 'cash') {
    const ownedReceipt = receipt.extend({invoice:invoice.extend({user_id:z.string().uuid()})})
    await pages(offset => {
      let read = client.from('invoice_payments')
      .select(`id,amount,paid_on,invoice:invoices!inner(invoice_number,currency,status${scope ? ',user_id' : ''}),reversal:invoice_payment_reversals(id)`)
      .eq('invoice.currency',query.currency).in('invoice.status',['SENT','PAID','OVERDUE'])
      .gte('paid_on',period.start).lt('paid_on',period.endExclusive).order('id')
      if (scope) read = read.eq('invoice.user_id',scope.ownerId)
      return read.range(offset,offset+pageSize-1)
    }, scope ? ownedReceipt : receipt, row => {
        if (scope) checkScope(ownedReceipt.parse(row).invoice.user_id,row.paid_on,row.invoice.currency)
        const reversed = Array.isArray(row.reversal) ? row.reversal.length > 0 : !!row.reversal
        if (!reversed) add({id:row.id,date:row.paid_on,type:'income',name:row.invoice.invoice_number,amount:row.amount,status:'RECEIVED'})
      })
  } else {
    const ownedIssued = issued.extend({user_id:z.string().uuid()})
    await pages(offset => {
      let read = client.from('invoices').select(`id,invoice_number,currency,status,issue_date,total${scope ? ',user_id' : ''}`)
      .eq('currency',query.currency).in('status',['SENT','PAID','OVERDUE'])
      .gte('issue_date',period.start).lt('issue_date',period.endExclusive).order('id')
      if (scope) read = read.eq('user_id',scope.ownerId)
      return read.range(offset,offset+pageSize-1)
    }, scope ? ownedIssued : issued, row => {
      if (scope) checkScope(ownedIssued.parse(row).user_id,row.issue_date,row.currency)
      add({id:row.id,date:row.issue_date,type:'income',name:row.invoice_number,amount:row.total,status:row.status})
    })
  }
  await pages(offset => {
    let read = client.from('expenses').select(`id,expense_date,amount,currency,description,merchant,status${scope ? ',user_id,category,receipt_path,receipt_url,reviewed_at' : ''}`)
    .eq('currency',query.currency).is('archived_at',null).neq('status','REJECTED')
    .gte('expense_date',period.start).lt('expense_date',period.endExclusive).order('id')
    if (scope) read = read.eq('user_id',scope.ownerId)
    return read.range(offset,offset+pageSize-1)
  }, scope ? expenseEvidenceSchema : expense, row => {
    if (scope) {
      const evidence = expenseEvidenceSchema.parse(row)
      checkScope(evidence.user_id,evidence.expense_date,evidence.currency)
      expenses.push(evidence)
    }
    add({id:row.id,date:row.expense_date,type:'expense',name:row.description || row.merchant || 'Expense',amount:row.amount,status:row.status})
  })
  rows.sort((a,b)=>a.date.localeCompare(b.date))
  const csv = workspacePeriodCsv(rows,period,query.currency,query.basis)
  if (new TextEncoder().encode(csv).byteLength > 2_000_000) throw new ReportLimitError()
  return { csv, filename:`amountly-workspace-${period.start}-${period.end}-${query.currency}.csv`,rows,expenses,period }
}
