import { getSupabaseClient } from '@/lib/supabase'
import { mapInvoice, serializeInvoiceStatus } from '@/lib/invoice-records'
import type { Invoice, CreateInvoiceInput, CreateInvoiceLineItemInput, InvoicePayment } from '@/types/models'

export interface InvoiceFilters {
  status?: string
  clientId?: string
  userId?: string
  organizationId?: string | null
}

export async function getInvoices(filters?: InvoiceFilters): Promise<Invoice[]> {
  const supabase = getSupabaseClient()
  let query = supabase
    .from('invoices')
    .select('*, client:clients(*), project:projects(*)')
    .order('created_at', { ascending: false }).order('id')

  if (filters?.status) {
    query = query.eq('status', serializeInvoiceStatus(filters.status) ?? filters.status)
  }
  if (filters?.clientId) {
    query = query.eq('client_id', filters.clientId)
  }
  if (filters?.organizationId) {
    query = query.eq('organization_id', filters.organizationId)
  } else if (filters?.userId) {
    query = query.eq('user_id', filters.userId)
  }

  const rows: Record<string, unknown>[] = []
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await query.range(offset, offset + 199)
    if (error) throw new Error('Could not load invoices. Please try again.')
    rows.push(...(data ?? []))
    if (!data || data.length < 200) break
  }
  const payments = await getAllPayments()
  const grouped = new Map<string, InvoicePayment[]>()
  for (const payment of payments) grouped.set(payment.invoice_id, [...(grouped.get(payment.invoice_id) ?? []), payment])
  return rows.map(row => mapInvoice({ ...row, payments: grouped.get(String(row.id)) ?? [] }))
}

export async function getInvoice(id: string): Promise<Invoice | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('invoices')
    .select('*, client:clients(*), project:projects(*), line_items:invoice_line_items(*), events:invoice_events(*)')
    .eq('id', id)
    .single()

  if (error) throw new Error('Could not load invoices. Please try again.')
  return data ? mapInvoice({ ...data, payments: await getAllPayments(id) }) : null
}


async function getAllPayments(invoiceId?: string): Promise<InvoicePayment[]> {
  const rows: InvoicePayment[] = []
  let query = getSupabaseClient().from('invoice_payments').select('id,invoice_id,amount,paid_on,method,reference,created_at').order('id')
  if (invoiceId) query = query.eq('invoice_id', invoiceId)
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await query.range(offset, offset + 199)
    if (error) throw new Error('Could not load payments. Please try again.')
    rows.push(...(data ?? []) as InvoicePayment[])
    if (!data || data.length < 200) break
  }
  return rows
}

function workflowError(code?: string): Error & { code?: string } {
  const messages: Record<string, string> = {
    'PT409': 'This invoice changed in another window. Reload it before saving.',
    '23505': 'That invoice number or request already exists. Reload before retrying.',
    '42501': 'You do not have permission to make this change.',
    '22023': 'Check the invoice state, dates, amounts, and outstanding balance before retrying.',
    '22007': 'Check the invoice dates before retrying.',
    '22008': 'Check the invoice dates before retrying.',
    '22P02': 'Check the invoice fields before retrying.',
    '23514': 'Check the invoice amounts before retrying.',
  }
  return Object.assign(new Error(messages[code ?? ''] ?? 'The change could not be confirmed. Reload to check its status before retrying.'), {
    code: code && messages[code] ? code : undefined,
  })
}

type LineInput = Omit<CreateInvoiceLineItemInput, 'invoice_id'>
export async function saveInvoiceDraft(id: string, input: CreateInvoiceInput, lines: LineInput[], expectedUpdatedAt?: string): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc('save_invoice', {
    p_id: id,
    p_expected_updated_at: expectedUpdatedAt ?? null,
    p_data: {
      client_id: input.client_id, project_id: input.project_id ?? null,
      invoice_number: input.invoice_number || null, issue_date: input.issue_date.slice(0, 10),
      due_date: input.due_date.slice(0, 10), tax_rate: input.tax_rate,
      currency: input.currency, notes: input.notes ?? '',
    },
    p_lines: lines.map(({ description, quantity, rate }) => ({ description, quantity, rate })),
  })
  if (error) throw workflowError(error.code)
  return String(data)
}

export async function createInvoice(input: CreateInvoiceInput, lines: LineInput[]): Promise<Invoice> {
  const id = await saveInvoiceDraft(crypto.randomUUID(), input, lines)
  const invoice = await getInvoice(id)
  if (!invoice) throw new Error('Invoice saved. Reload the list to view it.')
  return invoice
}

export async function invoiceAction(invoice: Invoice, action: 'issue' | 'delete' | 'cancel'): Promise<void> {
  const { error } = await getSupabaseClient().rpc('invoice_action', {
    p_id: invoice.id, p_action: action, p_expected_updated_at: invoice.updated_at,
  })
  if (error) throw workflowError(error.code)
}

export async function recordInvoicePayment(invoiceId: string, payment: Omit<InvoicePayment, 'invoice_id' | 'created_at'>): Promise<void> {
  const { error } = await getSupabaseClient().rpc('record_invoice_payment', {
    p_id: payment.id, p_invoice_id: invoiceId, p_amount: payment.amount,
    p_paid_on: payment.paid_on, p_method: payment.method, p_reference: payment.reference,
  })
  if (error) throw workflowError(error.code)
}
