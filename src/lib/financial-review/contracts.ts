import { z } from 'zod/v3'
import { AccountType, Role } from '@/types/enums'

export const day = z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).refine(value => {
  const d = new Date(`${value}T00:00:00Z`)
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}, 'Invalid calendar date')
// Database date columns include timestamptz; keep the record's calendar day.
export const storedDay = z.union([day, z.string().datetime({ offset: true }).transform(value => value.slice(0, 10))]).pipe(day)
export const periodFields = { start: day, end: day, currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD']) }
export const periodSchema = z.object(periodFields).strict().refine(p => p.end >= p.start &&
  Date.parse(p.end) - Date.parse(p.start) <= 30 * 86400000, 'Choose at most 31 days')
export type Period = z.infer<typeof periodSchema>
export const actorSchema = z.object({ id: z.string().uuid(), organization_id: z.string().uuid().nullable(),
  account_type: z.nativeEnum(AccountType), role: z.nativeEnum(Role), is_active: z.literal(true) })
export type Actor = z.infer<typeof actorSchema>
export const money = z.union([z.number(), z.string().regex(/^\d+(?:\.\d{1,2})?$/)])
  .pipe(z.coerce.number().finite().min(0).max(1e9)).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.0001)
export const owned = z.object({ id: z.string().uuid(), user_id: z.string().uuid().nullable(), organization_id: z.string().uuid().nullable() })
export const invoiceSchema = owned.extend({ invoice_number: z.string().max(100), total: money, currency: periodFields.currency,
  issue_date: storedDay, due_date: storedDay, status: z.enum(['DRAFT', 'SENT', 'OVERDUE', 'PAID', 'CANCELLED']) })
export const paymentSchema = z.object({ id: z.string().uuid(), invoice_id: z.string().uuid(), amount: money,
  reversal: z.union([z.object({ id: z.string().uuid() }), z.array(z.object({ id: z.string().uuid() })).max(1)]).nullable() })
export const billSchema = owned.extend({ name: z.string().max(500), amount: money, currency: periodFields.currency,
  due_date: storedDay, status: z.enum(['upcoming', 'due', 'overdue', 'paid', 'cancelled']), kind: z.enum(['bills', 'vendor_bills']) })
export const expenseSchema = owned.extend({ description: z.string().max(10000).nullable(), amount: money, currency: periodFields.currency,
  expense_date: storedDay, category: z.string().max(100).nullable(), status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REIMBURSED', 'REJECTED']),
  receipt_path: z.string().max(2000).nullable(), receipt_url: z.string().max(4000).nullable(), archived_at: z.string().nullable() })
export const snapshotSchema = z.object({ invoices: z.array(invoiceSchema).max(2000), payments: z.array(paymentSchema).max(2000),
  bills: z.array(billSchema).max(2000), expenses: z.array(expenseSchema).max(2000) }).strict()
export type Snapshot = z.infer<typeof snapshotSchema>
export class ReviewError extends Error {
  constructor(readonly status: number, message = 'Could not load the financial review. Try again.') { super(message) }
}
export const cents = (n: number) => Math.round(n * 100)
export const addDays = (value: string, count: number) => new Date(Date.parse(`${value}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10)
