import { getSupabaseClient } from '@/lib/supabase'
import type { TaxFiling, CreateTaxFilingInput, UpdateTaxFilingInput } from '@/types/models'

export async function getTaxFilings(): Promise<TaxFiling[]> {
  const supabase = getSupabaseClient()
  const rows: TaxFiling[] = []
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabase.from('tax_filings').select('*')
      .order('due_date').order('id').range(offset, offset + 199)
    if (error) throw new Error('Could not load filing reminders.')
    rows.push(...(data ?? []) as TaxFiling[])
    if (!data || data.length < 200) return rows
  }
}

export async function createTaxFiling(input: CreateTaxFilingInput): Promise<TaxFiling> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('tax_filings')
    .insert(input)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as TaxFiling
}

export async function updateTaxFiling(id: string, input: UpdateTaxFilingInput): Promise<TaxFiling> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('tax_filings')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as TaxFiling
}

export async function deleteTaxFiling(id: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('tax_filings')
    .delete()
    .eq('id', id)

  if (error) throw new Error(error.message)
}

export async function markTaxFilingFiled(id: string): Promise<TaxFiling> {
  return updateTaxFiling(id, {
    status: 'filed' as any,
    filed_date: new Date().toISOString().split('T')[0],
  })
}

// Seed standard quarterly estimated tax deadlines for the current year
export async function seedQuarterlyEstimates(year: number): Promise<void> {
  const { error } = await getSupabaseClient().rpc('seed_quarterly_estimates', { p_year: year })
  if (error) throw new Error('Could not add filing reminders. Reload before retrying.')
}
