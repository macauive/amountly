import type { Invoice } from '@/types/models'

export function formatInvoiceMoney(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

// Invoice dates are calendar dates, not instants in the viewer's timezone.
export function formatInvoiceDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

export function invoicePaymentSummary(invoice: Invoice) {
  const legacyPaid = invoice.status === 'PAID' && !invoice.payments?.length
  return {
    paid: formatInvoiceMoney(invoice.amount_paid ?? 0, invoice.currency),
    balance: formatInvoiceMoney(invoice.balance_due ?? invoice.total, invoice.currency),
    legacyPaid,
  }
}

export function invoicePdfFilename(number: string) {
  return `invoice-${number.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'document'}.pdf`
}
