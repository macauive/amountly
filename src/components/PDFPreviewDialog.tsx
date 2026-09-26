'use client'

import { InvoicePreview } from './InvoicePreview'
import type { Invoice, Organization } from '@/types/models'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'

interface PDFPreviewDialogProps {
  invoice: Invoice
  organization?: Organization | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function PDFPreviewDialog({
  invoice,
  organization,
  open,
  onOpenChange,
}: PDFPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="flex flex-wrap items-start justify-between gap-3 px-6 py-4 pr-12 border-b shrink-0">
          <div>
            <DialogTitle>Invoice {invoice.invoice_number}</DialogTitle>
            <DialogDescription>Review the invoice, then download a formatted PDF.</DialogDescription>
          </div>
          <Button asChild size="sm"><a href={`/api/invoices/${encodeURIComponent(invoice.id)}/pdf`}><Download className="w-4 h-4 mr-2" />Download PDF</a></Button>

        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-auto p-3 sm:p-6 bg-muted">
          <InvoicePreview invoice={invoice} organization={organization} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
