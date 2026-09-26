import { getSupabaseClient } from '@/lib/supabase'
import type { Bill, CreateBillInput, UpdateBillInput } from '@/types/models'
import { recordError } from '@/services/review.service'

export interface BillFilters {
  status?: string
  category?: string
}

export async function getBills(filters?: BillFilters): Promise<Bill[]> {
  const supabase = getSupabaseClient()
  let query = supabase
    .from('bills')
    .select('*')
    .order('due_date', { ascending: true })

  if (filters?.status) {
    query = query.eq('status', filters.status)
  }
  if (filters?.category) {
    query = query.eq('category', filters.category)
  }

  const rows: Bill[]=[]
  for (let offset=0; ; offset+=200) {
    const { data,error }=await query.order('id').range(offset,offset+199)
    if(error) throw new Error('Could not load bills.')
    rows.push(...(data ?? []) as Bill[])
    if(!data || data.length<200) return rows
  }
}

export async function getBill(id: string): Promise<Bill | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('bills')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw new Error(error.message)
  return data as Bill
}

export async function createBill(input: CreateBillInput, id = crypto.randomUUID()): Promise<Bill> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('bills')
    .insert({ ...input, id })
    .select()
    .single()

  if (error) throw recordError(error.code)
  return data as Bill
}

export async function updateBill(id: string, input: UpdateBillInput, expectedUpdatedAt: string): Promise<Bill> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('bills')
    .update(input)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select()
    .single()

  if (error) throw recordError(error.code)
  return data as Bill
}

export async function cancelBill(bill: Bill): Promise<void> {
  const { error } = await getSupabaseClient().rpc('bill_action', { p_id:bill.id,p_action:'cancel',p_expected_updated_at:bill.updated_at })
  if (error) throw recordError(error.code)
}

export async function markBillPaid(bill: Bill, paidOn: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc('bill_action', { p_id:bill.id,p_action:'pay',p_expected_updated_at:bill.updated_at,p_paid_on:paidOn })
  if (error) throw recordError(error.code)
}
