import type { Invoice, Organization } from '@/types/models'
import { invoiceStatusLabels } from '@/types/enums'
import { formatInvoiceDate, formatInvoiceMoney, invoicePaymentSummary } from '@/lib/invoice-document'

// Accessible document review also works in browsers without an embedded PDF viewer.
export function InvoicePreview({ invoice, organization }: { invoice: Invoice; organization?: Organization | null }) {
  const summary = invoicePaymentSummary(invoice)
  const money = (value: number) => formatInvoiceMoney(value, invoice.currency)
  return (
    <article aria-label="Invoice document" className="bg-white text-slate-900 p-5 sm:p-10 space-y-7 rounded-md">
      <header className="flex flex-wrap justify-between gap-4 border-b pb-5">
        <div><h3 className="text-xl font-semibold">{organization?.name || 'Amountly'}</h3>
          <p>{organization?.email}</p><p>{organization?.address}</p>
          <p>{[organization?.city, organization?.state, organization?.zip_code].filter(Boolean).join(', ')}</p></div>
        <div><p className="text-xl font-semibold">Invoice {invoice.invoice_number}</p><p>{invoiceStatusLabels[invoice.status]}</p></div>
      </header>
      <dl className="grid sm:grid-cols-3 gap-4 text-sm">
        <div><dt className="text-slate-600">Issue date</dt><dd>{formatInvoiceDate(invoice.issue_date)}</dd></div>
        <div><dt className="text-slate-600">Due date</dt><dd>{formatInvoiceDate(invoice.due_date)}</dd></div>
        <div><dt className="text-slate-600">Currency</dt><dd>{invoice.currency}</dd></div>
      </dl>
      <section><h4 className="font-semibold">Bill to</h4><p>{invoice.client?.name}</p><p>{invoice.client?.email}</p>
        <p>{invoice.client?.contact_name}</p><p>{invoice.client?.address}</p>
        <p>{[invoice.client?.city, invoice.client?.state, invoice.client?.zip_code].filter(Boolean).join(', ')}</p><p>{invoice.client?.country}</p></section>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left">
        <caption className="sr-only">Invoice line items</caption>
        <thead><tr className="border-b"><th className="py-3">Description</th><th className="px-3">Qty</th><th className="px-3 text-right">Rate</th><th className="text-right">Amount</th></tr></thead>
        <tbody>{invoice.line_items?.map(line => <tr key={line.id} className="border-b"><td className="py-3 whitespace-pre-wrap break-words">{line.description}</td><td className="px-3">{line.quantity}</td><td className="px-3 text-right whitespace-nowrap">{money(line.rate)}</td><td className="text-right whitespace-nowrap">{money(line.amount)}</td></tr>)}</tbody>
      </table></div>
      <dl className="ml-auto max-w-xs space-y-2">
        <div className="flex justify-between gap-4"><dt>Subtotal</dt><dd>{money(invoice.subtotal)}</dd></div>
        <div className="flex justify-between gap-4"><dt>Tax ({invoice.tax_rate}%)</dt><dd>{money(invoice.tax_amount)}</dd></div>
        <div className="flex justify-between gap-4 font-semibold"><dt>Total</dt><dd>{money(invoice.total)}</dd></div>
        {!summary.legacyPaid && <div className="flex justify-between gap-4"><dt>Payments recorded</dt><dd>{summary.paid}</dd></div>}
        <div className="flex justify-between gap-4 font-semibold border-t pt-2"><dt>Balance due</dt><dd>{summary.balance}</dd></div>
      </dl>
      {summary.legacyPaid && <p className="text-sm">Marked paid in historical records. Payment details are unavailable.</p>}
      {invoice.notes && <section><h4 className="font-semibold">Notes</h4><p className="whitespace-pre-wrap break-words">{invoice.notes}</p></section>}
    </article>
  )
}
