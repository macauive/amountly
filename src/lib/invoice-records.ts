import { format } from 'date-fns'
import { InvoiceStatus } from '@/types/enums'
import type { Invoice, InvoiceLineItem, InvoicePayment } from '@/types/models'

type InvoiceRow = Record<string, unknown>
type InvoiceLineItemRow = Record<string, unknown>

export function normalizeInvoiceStatus(status: unknown): InvoiceStatus {
  const normalized = String(status ?? InvoiceStatus.draft)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')

  switch (normalized) {
    case InvoiceStatus.sent:
      return InvoiceStatus.sent
    case InvoiceStatus.paid:
      return InvoiceStatus.paid
    case InvoiceStatus.overdue:
      return InvoiceStatus.overdue
    case InvoiceStatus.cancelled:
      return InvoiceStatus.cancelled
    case InvoiceStatus.draft:
      return InvoiceStatus.draft
    default:
      throw new Error('Invoice has an unsupported status.')
  }
}

export function serializeInvoiceStatus(status: InvoiceStatus | string | undefined): string | undefined {
  if (!status) return undefined
  return normalizeInvoiceStatus(status).toUpperCase()
}

function mapInvoiceLineItem(row: unknown): InvoiceLineItem {
  const item = (row ?? {}) as InvoiceLineItemRow

  return {
    id: String(item.id ?? ''),
    invoice_id: String(item.invoice_id ?? ''),
    description: String(item.description ?? ''),
    quantity: Number(item.quantity ?? 0),
    rate: Number(item.rate ?? 0),
    amount: Number(item.amount ?? 0),
    order: Number(item.order ?? 0),
    created_at: String(item.created_at ?? ''),
    updated_at: String(item.updated_at ?? ''),
  }
}

export function mapInvoice(row: unknown): Invoice {
  const invoice = (row ?? {}) as InvoiceRow

  const payments = Array.isArray(invoice.payments)
    ? invoice.payments.map(p => ({ ...p, amount: Number(p.amount), reversal: Array.isArray(p.reversal) ? p.reversal[0] ?? null : p.reversal ?? null })) as InvoicePayment[] : []
  const total = Number(invoice.total ?? 0)
  const amountPaid = payments.filter(p => !p.reversal).reduce((sum, p) => sum + Math.round(p.amount * 100), 0) / 100
  let status = normalizeInvoiceStatus(invoice.status)
  const balance = (status === InvoiceStatus.paid || status === InvoiceStatus.cancelled) ? 0 : Math.max(0, Math.round((total - amountPaid) * 100) / 100)
  if ((status === InvoiceStatus.sent || status === InvoiceStatus.overdue) && balance > 0) {
    status = String(invoice.due_date).slice(0, 10) < format(new Date(), 'yyyy-MM-dd') ? InvoiceStatus.overdue : InvoiceStatus.sent
  }
  const snapshot = invoice.issued_snapshot as Invoice['issued_snapshot']
  return {
    payments,
    time_links: Array.isArray(invoice.time_links) ? invoice.time_links : [],
    events: Array.isArray(invoice.events) ? invoice.events : [],
    legacy_reviews: Array.isArray(invoice.legacy_reviews) ? invoice.legacy_reviews
      : invoice.legacy_reviews && typeof invoice.legacy_reviews === 'object' ? [invoice.legacy_reviews as NonNullable<Invoice['legacy_reviews']>[number]] : [],
    amount_paid: amountPaid,
    balance_due: balance,
    workflow_version: Number(invoice.workflow_version ?? 0),
    issued_snapshot: snapshot,
    id: String(invoice.id ?? ''),
    organization_id: invoice.organization_id ? String(invoice.organization_id) : undefined,
    user_id: invoice.user_id ? String(invoice.user_id) : undefined,
    client_id: invoice.client_id ? String(invoice.client_id) : undefined,
    project_id: invoice.project_id ? String(invoice.project_id) : undefined,
    invoice_number: String(invoice.invoice_number ?? ''),
    issue_date: String(invoice.issue_date ?? ''),
    due_date: String(invoice.due_date ?? ''),
    subtotal: Number(invoice.subtotal ?? 0),
    tax_rate: Number(invoice.tax_rate ?? 0),
    tax_amount: Number(invoice.tax_amount ?? 0),
    total: Number(invoice.total ?? 0),
    currency: String(invoice.currency ?? 'USD'),
    status,
    notes: typeof invoice.notes === 'string' ? invoice.notes : undefined,
    paid_at: typeof invoice.paid_at === 'string' ? invoice.paid_at : undefined,
    created_at: String(invoice.created_at ?? ''),
    updated_at: String(invoice.updated_at ?? ''),
    client: snapshot?.client ? snapshot.client as Invoice['client'] : invoice.client as Invoice['client'],
    project: invoice.project as Invoice['project'],
    line_items: Array.isArray(invoice.line_items) ? invoice.line_items.map(mapInvoiceLineItem).sort((a,b) => a.order-b.order) : undefined,
  }
}
