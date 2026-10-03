import { z } from 'zod/v3'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { appOrigin } from '@/lib/platform/config'
import { periodSchema, periodFields, cents, day } from '@/lib/financial-review/contracts'
import { loadReviewSnapshot, readActor, readSourceRecord, recordQuerySchema, reviewForClient, safeReviewFailure } from '@/lib/financial-review/service'
import type { FinancialReview } from '@/lib/financial-review/calculate'
import { readScope } from '@/lib/chatgpt/config'
import type { ReviewClient } from '@/lib/financial-review/service'
import { authPool } from '@/lib/platform/auth'

const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
const labels = { invoices: 'Invoice', bills: 'Bill', vendor_bills: 'Vendor bill', expenses: 'Expense' } as const
const source = (record: { kind: string; id: string; href: string }) => ({ kind: record.kind, id: record.id,
  label: labels[record.kind as keyof typeof labels] ?? 'Record', href: `${appOrigin()}${record.href}` })

// No arbitrary record descriptions, names, tax IDs or receipt URLs cross the
// model boundary. This also keeps stored prompt injection out of tool results.
export function publicReview(review: FinancialReview) {
  return { ...review, unpaid: review.unpaid.map(row => ({ ...row, source: source(row.source) })),
    obligations: review.obligations.map(row => ({ ...row, source: source(row.source) })),
    findings: review.findings.map(row => ({ ...row, source: source(row.source) })) }
}

export function createAmountlyMcp(client: ReviewClient) {
  const server = new McpServer({ name: 'amountly', version: '1.0.0' })
  const securitySchemes = [{ type: 'oauth2', scopes: [readScope] }]
  const register = (name: string, title: string, description: string, schema: z.AnyZodObject,
    run: (input: Record<string, unknown>) => Promise<object>) => {
    server.registerTool(name, { title, description, inputSchema: schema, annotations,
      _meta: { securitySchemes }, }, async input => {
      const audit = async (outcome: 'success' | 'error') => {
        const { data } = await client.auth.getUser()
        const id = z.string().uuid().parse(data.user?.id)
        await authPool().query("delete from amountly_auth.mcp_audit where created_at < now()-interval '30 days'")
        await authPool().query('insert into amountly_auth.mcp_audit(user_id,tool,outcome) values($1,$2,$3)', [id,name,outcome])
      }
      try {
        const result = await run(input)
        if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 128000) {
          await audit('error')
          return { isError: true, content: [{ type: 'text' as const, text: 'Too many results for one request. No partial totals were returned.' }] }
        }
        await audit('success')
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result as Record<string, unknown> }
      } catch (error) {
        try { await audit('error') } catch { /* No financial result is released after an audit failure. */ }
        return { isError: true, content: [{ type: 'text' as const, text: safeReviewFailure(error).message }] }
      }
    })
  }
  const periodInput = z.object(periodFields).strict()
  const current = () => day.parse(new Date().toISOString().slice(0, 10))
  const readReview = async (input: Record<string, unknown>) => publicReview(await reviewForClient(client, periodSchema.parse(input), current()))
  register('get_financial_review', 'Review finances',
    'Review outstanding invoice balances, past-due and next-seven-day bills, period expenses and receipt/comparison flags in the linked Amountly account. Choose one currency and at most 31 days. Balances are current; expenses use the selected dates. Results include supporting Amountly record links. Read-only bookkeeping information; no payments, emails, tax filing or financial advice.',
    periodInput, readReview)
  register('list_unpaid_invoices', 'Find unpaid invoices',
    'Find currently unpaid issued invoices and verified remaining balances in the linked Amountly account, including partial payments and reversals. Choose a currency; optionally return only overdue invoices. No invoice changes or reminders are sent.',
    z.object({ currency: periodFields.currency, overdue_only: z.boolean().default(false) }).strict(), async input => {
      const review = await readReview({ start: current(), end: current(), currency: input.currency })
      const invoices = review.unpaid.filter(row => !input.overdue_only || row.overdue)
      return { asOf: review.asOf, currency: input.currency, invoices,
        total: invoices.reduce((sum, row) => sum + cents(row.amount), 0) / 100,
        notes: ['Current balances include recorded payments and reversals. Draft and cancelled invoices are excluded.'] }
    })
  register('list_upcoming_bills', 'Find bills due soon',
    'List unpaid bills that are past due or due in the next seven days in the linked Amountly account, for one currency. Personal bills and authorized vendor bills follow existing account permissions. No bill payment or cancellation is performed.',
    z.object({ currency: periodFields.currency }).strict(), async input => {
      const review = await readReview({ start: current(), end: current(), currency: input.currency })
      return { asOf: review.asOf, horizon: review.horizon, currency: input.currency,
        obligations: review.obligations, total: review.totals.obligations,
        notes: ['Includes past-due obligations and the next seven days, inclusive. Check actual payment arrangements.'] }
    })
  register('summarize_expenses', 'Summarize expenses',
    'Summarize non-archived, non-rejected Amountly expenses for one currency and at most 31 days; include record links and missing-receipt flags. Receipt presence does not verify its contents. Raw descriptions, receipt files and receipt access URLs are never returned.',
    periodInput, async input => {
      const period = periodSchema.parse(input), actor = await readActor(client)
      const snapshot = await loadReviewSnapshot(client, actor, period)
      const expenses = snapshot.expenses.filter(row => row.expense_date >= period.start && row.expense_date <= period.end)
        .map(row => ({ id: row.id, amount: row.amount, currency: row.currency, date: row.expense_date,
          receiptAttached: !!(row.receipt_path?.trim() || row.receipt_url?.trim()),
          source: source({ kind: 'expenses', id: row.id, href: `/financial-review/record?kind=expenses&id=${row.id}` }) }))
      return { period, expenses, count: expenses.length, total: expenses.reduce((sum, row) => sum + cents(row.amount), 0) / 100,
        missingReceipts: expenses.filter(row => !row.receiptAttached).length,
        notes: ['Includes non-archived, non-rejected records. This is a bookkeeping review, not an accounting or tax statement.'] }
    })
  register('get_financial_record', 'Explain a supporting record',
    'Retrieve the amount, currency, date, status and receipt-presence flag for one Amountly record referenced by a review. Requires the linked user to have access to that record. Returns no raw descriptions, customer identifiers or receipt access URLs. No financial records are changed.',
    recordQuerySchema, async input => {
      const record = await readSourceRecord(client, input)
      return { ...record, label: labels[record.kind],
        href: `${appOrigin()}/financial-review/record?kind=${record.kind}&id=${record.id}` }
    })
  return server
}
