import { getSupabaseClient } from '@/lib/supabase'

const tables = new Set(['invoice_payments', 'invoice_payment_reversals', 'invoices', 'invoice_line_items', 'expenses', 'bills', 'clients', 'projects', 'time_entries', 'tax_filings', 'vendors', 'vendor_bills', 'purchase_orders', 'employees', 'inventory_items'])

// Authorization remains enforced by database RLS for every page.
export async function getExportRows(table: string): Promise<Record<string, unknown>[]> {
  if (!tables.has(table)) throw new Error('Unsupported export')
  const rows: Record<string, unknown>[] = []
  const supabase = getSupabaseClient()
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from(table).select('*').order('id').range(offset, offset + 499)
    if (error) throw new Error('Could not export these records. Please try again.')
    rows.push(...((data || []) as Record<string, unknown>[]).map(({ receipt_url, receipt_path, issued_snapshot, ...row }) => row))
    if (!data || data.length < 500) break
  }
  return rows
}
