import { getSupabaseClient } from '@/lib/supabase'
import type {
  Vendor,
  CreateVendorInput,
  UpdateVendorInput,
  VendorBill,
  CreateVendorBillInput,
  UpdateVendorBillInput,
  PurchaseOrder,
  CreatePurchaseOrderInput,
} from '@/types/models'
import { BillStatus, PurchaseOrderStatus } from '@/types/enums'
import { recordError } from '@/services/review.service'

type LegacyVendorBillRow = VendorBill & {
  date?: string
}

function mapVendorBill(row: LegacyVendorBillRow): VendorBill {
  return {
    ...row,
    issue_date: row.issue_date ?? row.date ?? row.due_date,
  }
}

// ─── Vendors ─────────────────────────────────────────────────

export async function getVendors(): Promise<Vendor[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('vendors')
    .select('*')
    .is('archived_at',null)
    .order('name', { ascending: true })

  if (error) throw new Error(error.message)
  return data as Vendor[]
}

export async function createVendor(input: CreateVendorInput): Promise<Vendor> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('vendors')
    .insert(input)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as Vendor
}

export async function updateVendor(id: string, input: UpdateVendorInput): Promise<Vendor> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('vendors')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as Vendor
}

export async function archiveVendor(id: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('vendors').update({archived_at:new Date().toISOString()}).eq('id', id).select('id').single()
  if (error) throw new Error(error.message)
}

// ─── Vendor Bills ─────────────────────────────────────────────

export async function getVendorBills(): Promise<VendorBill[]> {
  const supabase = getSupabaseClient()
  const rows: VendorBill[] = []
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabase.from('vendor_bills')
      .select('*, vendor:vendors(*), line_items:vendor_bill_line_items(*)')
      .order('due_date').order('id').range(offset, offset + 199)
    if (error) throw new Error('Could not load vendor bills.')
    rows.push(...(data as LegacyVendorBillRow[] ?? []).map(mapVendorBill))
    if (!data || data.length < 200) return rows
  }
}

export async function createVendorBill(
  input: CreateVendorBillInput,
  lineItems: { description: string; quantity: number; rate: number; amount: number; order: number }[],
  requestId = crypto.randomUUID()
): Promise<VendorBill> {
  const supabase = getSupabaseClient()
  const { data: id, error } = await supabase.rpc('save_vendor_bill', {
    p_id: requestId,
    p_data: { vendor_id:input.vendor_id,bill_number:input.bill_number,issue_date:input.issue_date,due_date:input.due_date,tax_rate:input.tax_rate,currency:input.currency,notes:input.notes ?? '' },
    p_lines:lineItems.map(({description,quantity,rate})=>({description,quantity,rate})),
  })
  if(error) throw recordError(error.code)
  const {data,error:readError}=await supabase.from('vendor_bills').select('*').eq('id',id).single()
  if(readError) throw recordError()
  return mapVendorBill(data as LegacyVendorBillRow)
}

export async function cancelVendorBill(bill: VendorBill): Promise<void> {
  const {error}=await getSupabaseClient().rpc('vendor_bill_action',{p_id:bill.id,p_action:'cancel',p_expected_updated_at:bill.updated_at})
  if(error) throw recordError(error.code)
}

export async function markVendorBillPaid(bill: VendorBill, paidOn: string): Promise<void> {
  const {error}=await getSupabaseClient().rpc('vendor_bill_action',{p_id:bill.id,p_action:'pay',p_expected_updated_at:bill.updated_at,p_paid_on:paidOn})
  if(error) throw recordError(error.code)
}

export async function generateBillNumber(): Promise<string> {
  const supabase = getSupabaseClient()
  const year = new Date().getFullYear()
  const { count } = await supabase
    .from('vendor_bills')
    .select('*', { count: 'exact', head: true })
  const num = (count || 0) + 1
  return `BILL-${year}-${num.toString().padStart(4, '0')}`
}

// ─── Purchase Orders ──────────────────────────────────────────

export async function getPurchaseOrders(): Promise<PurchaseOrder[]> {
  const rows: PurchaseOrder[] = []
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await getSupabaseClient().from('purchase_orders')
      .select('*, vendor:vendors(*), line_items:purchase_order_line_items(*)').order('date', { ascending: false }).order('id').range(offset, offset + 199)
    if (error) throw new Error('Could not load purchase orders.')
    rows.push(...(data ?? []) as PurchaseOrder[])
    if (!data || data.length < 200) return rows
  }
}

export async function createPurchaseOrder(
  input: CreatePurchaseOrderInput,
  lineItems: { description: string; quantity: number; rate: number; amount: number; order: number }[],
  requestId = crypto.randomUUID()
): Promise<PurchaseOrder> {
  const supabase = getSupabaseClient()
  const { data: id, error } = await supabase.rpc('save_purchase_order', {
    p_id: requestId,
    p_data: { vendor_id: input.vendor_id, po_number: input.po_number, date: input.date, expected_date: input.expected_date ?? null, tax_rate: input.tax_rate, currency: input.currency, notes: input.notes ?? '' },
    p_lines: lineItems.map(({ description, quantity, rate }) => ({ description, quantity, rate })),
  })
  if (error) throw recordError(error.code)
  const { data, error: readError } = await supabase.from('purchase_orders').select('*').eq('id', id).single()
  if (readError) throw recordError()
  return data as PurchaseOrder
}

export async function purchaseOrderAction(po: PurchaseOrder, action: 'send' | 'receive' | 'cancel'): Promise<void> {
  const { error } = await getSupabaseClient().rpc('purchase_order_action', { p_id: po.id, p_action: action, p_expected_updated_at: po.updated_at })
  if (error) throw recordError(error.code)
}

export async function generatePONumber(): Promise<string> {
  const supabase = getSupabaseClient()
  const year = new Date().getFullYear()
  const { count } = await supabase
    .from('purchase_orders')
    .select('*', { count: 'exact', head: true })
  const num = (count || 0) + 1
  return `PO-${year}-${num.toString().padStart(4, '0')}`
}
