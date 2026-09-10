import { z } from 'zod'
import { AccountType, ExpenseCategory } from '@/types/enums'

export const aiRoutes = ['/dashboard', '/bills', '/expenses', '/invoices', '/time-entries', '/tax'] as const
const optionalDate = z.union([z.literal(''), z.string().date()])
const optionalTime = z.union([z.literal(''), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)])
const moneyText = z.union([z.literal(''), z.string().max(12).regex(/^\d{1,8}(\.\d{1,2})?$/)])
const lineSchema = z.object({
  description: z.string().max(2000),
  quantity: z.number().finite().min(0).max(99999999.99),
  rate: z.number().finite().min(0).max(99999999.99),
  amount: z.number().finite().min(0).max(99999999.99),
  reason: z.string().max(2000),
}).strict().refine(line => Math.abs(line.amount - Math.round(line.quantity * line.rate * 100) / 100) < 0.005)

export const schemas = {
  expense_capture: z.object({
    amount: moneyText,
    merchant: z.string().max(2000),
    description: z.string().max(2000),
    expense_date: optionalDate,
    category: z.nativeEnum(ExpenseCategory),
    confidence: z.enum(['high', 'medium', 'low']),
    reason: z.string().max(2000),
  }).strict(),
  receipt_capture: z.object({
    amount: moneyText,
    merchant: z.string().max(2000),
    description: z.string().max(2000),
    expense_date: optionalDate,
    category: z.nativeEnum(ExpenseCategory),
    confidence: z.enum(['high', 'medium', 'low']),
    reason: z.string().max(2000),
    notes: z.string().max(2000),
    summary: z.string().max(2000),
  }).strict(),
  invoice_line: lineSchema,
  invoice_reminder: z.object({
    tone: z.enum(['friendly', 'firm']),
    subject: z.string().max(2000),
    body: z.string().max(2000),
    reason: z.string().max(2000),
  }).strict(),
  time_entry: z.object({
    date: optionalDate,
    start_time: optionalTime,
    end_time: optionalTime,
    notes: z.string().max(2000),
    duration_minutes: z.number().int().min(0).max(1440),
    reason: z.string().max(2000),
  }).strict(),
  contact_capture: z.object({
    name: z.string().max(2000),
    contact_name: z.string().max(2000),
    email: z.string().max(2000),
    phone: z.string().max(2000),
    address: z.string().max(2000),
    city: z.string().max(2000),
    state: z.string().max(2000),
    zip_code: z.string().max(2000),
    notes: z.string().max(2000),
    reason: z.string().max(2000),
  }).strict(),
  time_invoice_draft: z.object({
    lineItems: z.array(lineSchema).max(8),
    summary: z.string().max(2000),
    clientId: z.union([z.literal(''), z.string().uuid()]),
  }).strict(),
  dashboard_insights: z.object({
    nextSteps: z.array(z.object({
      id: z.string().max(2000),
      title: z.string().max(2000),
      detail: z.string().max(2000),
      href: z.enum(aiRoutes),
      priority: z.enum(['high', 'medium', 'low']),
    }).strict()).max(12),
    monthlySummary: z.object({
      headline: z.string().max(2000),
      body: z.string().max(2000),
      highlights: z.array(z.string().max(2000)).max(12),
    }).strict(),
    searchResults: z.array(z.object({
      id: z.string().max(2000),
      title: z.string().max(2000),
      detail: z.string().max(2000),
      href: z.enum(aiRoutes),
      label: z.string().max(2000),
      priority: z.enum(['high', 'medium', 'low']),
    }).strict()).max(12),
  }).strict(),
}

export type AiTask = keyof typeof schemas
export const aiTaskNames = Object.keys(schemas) as [AiTask, ...AiTask[]]
export const aiRequestSchema = z.object({
  task: z.enum(aiTaskNames),
  payload: z.union([z.string().min(1).max(12000), z.record(z.unknown())]),
}).strict()

const note = z.string().min(1).max(12000)
const text = z.string().max(2000)
const money = z.number().finite().min(0).max(99999999.99)
const summaryRecord = z.object({
  id: z.string().uuid(), label: text, amount: money.optional(),
  date: z.string().max(40), status: z.string().max(40),
  category: z.string().max(80).optional(), needsReceipt: z.boolean().optional(),
}).strict()
export const payloadSchemas = {
  expense_capture: z.union([note, z.object({ merchant: text.optional(), description: text.optional(), notes: text.optional() }).strict()]),
  receipt_capture: note,
  invoice_line: note,
  contact_capture: note,
  time_entry: note,
  invoice_reminder: z.object({
    invoice_number: text, total: money, currency: z.string().length(3), due_date: z.string().max(40), status: z.string().max(40),
    client: z.object({ name: text.optional(), contact_name: text.optional() }).strict(),
  }).strict(),
  time_invoice_draft: z.object({
    fallbackRate: money,
    entries: z.array(z.object({
      id: z.string().uuid(), hours: z.number().finite().min(0).max(10000), rate: money,
      notes: text.optional(),
      project: z.object({ name: text, client_id: z.string().uuid().optional() }).strict().nullable(),
      task: z.object({ name: text }).strict().nullable(),
    }).strict()).max(8),
  }).strict(),
  dashboard_insights: z.object({
    accountType: z.nativeEnum(AccountType), searchQuery: text,
    bills: z.array(summaryRecord).max(100), expenses: z.array(summaryRecord).max(100),
    workData: z.object({
      invoices: z.array(summaryRecord).max(100), expenses: z.array(summaryRecord).max(100),
      timeEntries: z.array(summaryRecord).max(100), vendorBills: z.array(summaryRecord).max(100),
    }).strict(),
    candidateHrefs: z.array(z.enum(aiRoutes)).max(6),
  }).strict(),
}

// This is raw HTTP Responses API output, not the SDK's output_text helper.
export function parseResponseOutput(body: unknown): unknown {
  const response = z.object({
    status: z.literal('completed'),
    output: z.array(z.object({
      type: z.string(),
      content: z.array(z.object({ type: z.string(), text: z.string().max(32000).optional() })).max(64).optional(),
    })).max(64),
  }).parse(body)
  const content = response.output.filter(item => item.type === 'message').flatMap(item => item.content ?? [])
  if (content.some(item => item.type === 'refusal')) throw new Error('AI refused the request')
  const text = content.filter(item => item.type === 'output_text').map(item => item.text ?? '').join('')
  if (!text || text.length > 32000) throw new Error('Invalid AI output')
  return JSON.parse(text)
}
