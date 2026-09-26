import React from 'react'
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
} from '@react-pdf/renderer'
import type { Invoice } from '@/types/models'
import type { Organization } from '@/types/models'
import { invoiceStatusLabels } from '@/types/enums'
import { formatInvoiceDate as formatDate, formatInvoiceMoney as formatCurrency, invoicePaymentSummary } from '@/lib/invoice-document'

// ─── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    paddingTop: 48,
    paddingBottom: 48,
    paddingHorizontal: 48,
    backgroundColor: '#ffffff',
    color: '#111827',
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 36,
  },
  brandName: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    letterSpacing: 0.5,
  },
  brandSub: {
    fontSize: 9,
    color: '#6b7280',
    marginTop: 2,
  },
  invoiceTitle: {
    textAlign: 'right',
  },
  invoiceTitleText: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  statusBadge: {
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    alignSelf: 'flex-end',
  },
  statusText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Divider
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    marginBottom: 24,
  },

  // Meta row: Invoice # / Dates
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  metaBlock: {
    flex: 1,
  },
  metaLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  metaValue: {
    fontSize: 10,
    color: '#111827',
  },

  // Bill To / From
  addressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 28,
    gap: 16,
  },
  addressBlock: {
    flex: 1,
  },
  addressTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  addressName: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    marginBottom: 2,
  },
  addressLine: {
    fontSize: 9,
    color: '#6b7280',
    lineHeight: 1.5,
  },

  // Line items table
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f9fafb',
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 0,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb',
  },
  tableRowAlt: {
    backgroundColor: '#f9fafb',
  },
  tableColDescription: { flex: 4 },
  tableColQty: { flex: 1, textAlign: 'center' },
  tableColRate: { flex: 1.5, textAlign: 'right' },
  tableColAmount: { flex: 1.5, textAlign: 'right' },
  tableHeaderText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  tableCellText: {
    fontSize: 9,
    color: '#374151',
  },

  // Totals
  totalsSection: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
  },
  totalsBlock: {
    width: 200,
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  totalsLabel: {
    fontSize: 9,
    color: '#6b7280',
  },
  totalsValue: {
    fontSize: 9,
    color: '#111827',
  },
  totalsDivider: {
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    marginVertical: 4,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  totalLabel: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  totalValue: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },

  // Notes
  notesSection: {
    marginTop: 28,
  },
  notesTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  notesText: {
    fontSize: 9,
    color: '#6b7280',
    lineHeight: 1.6,
  },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 32,
    left: 48,
    right: 48,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 8,
    color: '#9ca3af',
  },
})

// ─── Helpers ─────────────────────────────────────────────────

function getStatusColors(status: string): { bg: string; color: string } {
  switch (status.toLowerCase()) {
    case 'paid': return { bg: '#dcfce7', color: '#16a34a' }
    case 'overdue': return { bg: '#fee2e2', color: '#dc2626' }
    case 'sent': return { bg: '#dbeafe', color: '#2563eb' }
    case 'cancelled': return { bg: '#f3f4f6', color: '#6b7280' }
    default: return { bg: '#fef9c3', color: '#ca8a04' }
  }
}

// ─── Component ───────────────────────────────────────────────

interface InvoicePDFProps {
  invoice: Invoice
  organization?: Pick<Organization, 'name' | 'email' | 'address' | 'city' | 'state' | 'zip_code'> | null
}

export function InvoicePDF({ invoice, organization }: InvoicePDFProps) {
  const summary = invoicePaymentSummary(invoice)
  const statusColors = getStatusColors(invoice.status)
  const lineItems = invoice.line_items || []

  return (
    <Document
      title={`Invoice ${invoice.invoice_number}`}
      author={organization?.name || 'Amountly'}
    >
      <Page size="A4" style={styles.page}>

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brandName}>{organization?.name || 'Amountly'}</Text>
            {organization?.email && <Text style={styles.brandSub}>{organization.email}</Text>}
            {organization?.address && <Text style={styles.brandSub}>{organization.address}</Text>}
            {(organization?.city || organization?.state) && (
              <Text style={styles.brandSub}>
                {[organization.city, organization.state, organization.zip_code].filter(Boolean).join(', ')}
              </Text>
            )}
          </View>
          <View style={styles.invoiceTitle}>
            <Text style={styles.invoiceTitleText}>Invoice</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColors.bg }]}>
              <Text style={[styles.statusText, { color: statusColors.color }]}>
                {invoiceStatusLabels[invoice.status]}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Invoice Meta */}
        <View style={styles.metaRow}>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Invoice Number</Text>
            <Text style={styles.metaValue}>{invoice.invoice_number}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Issue Date</Text>
            <Text style={styles.metaValue}>{formatDate(invoice.issue_date)}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Due Date</Text>
            <Text style={styles.metaValue}>{formatDate(invoice.due_date)}</Text>
          </View>
          {invoice.paid_at && (
            <View style={styles.metaBlock}>
              <Text style={styles.metaLabel}>Paid On</Text>
              <Text style={styles.metaValue}>{formatDate(invoice.paid_at)}</Text>
            </View>
          )}
        </View>

        {/* Addresses */}
        <View style={styles.addressRow}>
          <View style={styles.addressBlock}>
            <Text style={styles.addressTitle}>Bill To</Text>
            {invoice.client ? (
              <>
                <Text style={styles.addressName}>{invoice.client.name}</Text>
                {invoice.client.email && <Text style={styles.addressLine}>{invoice.client.email}</Text>}
                {invoice.client.contact_name && <Text style={styles.addressLine}>{invoice.client.contact_name}</Text>}
                {invoice.client.address && <Text style={styles.addressLine}>{invoice.client.address}</Text>}
                {(invoice.client.city || invoice.client.state) && (
                  <Text style={styles.addressLine}>
                    {[invoice.client.city, invoice.client.state, invoice.client.zip_code].filter(Boolean).join(', ')}
                  </Text>
                )}
                {invoice.client.country && <Text style={styles.addressLine}>{invoice.client.country}</Text>}
              </>
            ) : (
              <Text style={styles.addressLine}>No client specified</Text>
            )}
          </View>
          {invoice.project && (
            <View style={styles.addressBlock}>
              <Text style={styles.addressTitle}>Project</Text>
              <Text style={styles.addressName}>{invoice.project.name}</Text>
            </View>
          )}
        </View>

        {/* Line Items */}
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, styles.tableColDescription]}>Description</Text>
          <Text style={[styles.tableHeaderText, styles.tableColQty]}>Qty</Text>
          <Text style={[styles.tableHeaderText, styles.tableColRate]}>Rate</Text>
          <Text style={[styles.tableHeaderText, styles.tableColAmount]}>Amount</Text>
        </View>
        {lineItems.map((item, i) => (
          <View key={item.id} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
            <Text style={[styles.tableCellText, styles.tableColDescription]}>{item.description}</Text>
            <Text style={[styles.tableCellText, styles.tableColQty]}>{item.quantity}</Text>
            <Text style={[styles.tableCellText, styles.tableColRate]}>
              {formatCurrency(item.rate, invoice.currency)}
            </Text>
            <Text style={[styles.tableCellText, styles.tableColAmount]}>
              {formatCurrency(item.amount, invoice.currency)}
            </Text>
          </View>
        ))}

        {/* Totals */}
        <View style={styles.totalsSection}>
          <View style={styles.totalsBlock}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal</Text>
              <Text style={styles.totalsValue}>{formatCurrency(invoice.subtotal, invoice.currency)}</Text>
            </View>
            {invoice.tax_rate > 0 && (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Tax ({invoice.tax_rate}%)</Text>
                <Text style={styles.totalsValue}>{formatCurrency(invoice.tax_amount, invoice.currency)}</Text>
              </View>
            )}
            <View style={styles.totalsDivider} />
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>{formatCurrency(invoice.total, invoice.currency)}</Text>
            </View>
            {!summary.legacyPaid && <View style={styles.totalsRow}><Text style={styles.totalsLabel}>Payments recorded</Text><Text style={styles.totalsValue}>{summary.paid}</Text></View>}
            <View style={styles.totalRow}><Text style={styles.totalLabel}>Balance due</Text><Text style={styles.totalValue}>{summary.balance}</Text></View>
            {summary.legacyPaid && <Text style={styles.notesText}>Marked paid in historical records. Payment details are unavailable.</Text>}
          </View>
        </View>

        {/* Notes */}
        {invoice.notes && (
          <View style={styles.notesSection}>
            <Text style={styles.notesTitle}>Notes</Text>
            <Text style={styles.notesText}>{invoice.notes}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {organization?.name || 'Amountly'} · {invoice.invoice_number}
          </Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages}`
          } />
        </View>

      </Page>
    </Document>
  )
}
