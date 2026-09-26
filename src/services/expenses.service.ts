import { getSupabaseClient } from '@/lib/supabase'
import type { Expense, CreateExpenseInput, UpdateExpenseInput } from '@/types/models'
import { recordError } from '@/services/review.service'

export interface ExpenseFilters {
  startDate?: string
  endDate?: string
  category?: string
  status?: string
  projectId?: string
}

export async function getExpenses(filters?: ExpenseFilters): Promise<Expense[]> {
  const supabase = getSupabaseClient()
  let query = supabase
    .from('expenses')
    .select('*, project:projects(*)')
    .is('archived_at', null)
    .order('expense_date', { ascending: false })

  if (filters?.startDate) {
    query = query.gte('expense_date', filters.startDate)
  }
  if (filters?.endDate) {
    query = query.lte('expense_date', filters.endDate)
  }
  if (filters?.category) {
    query = query.eq('category', filters.category)
  }
  if (filters?.status) {
    query = query.eq('status', filters.status)
  }
  if (filters?.projectId) {
    query = query.eq('project_id', filters.projectId)
  }

  const rows: Expense[] = []
  for(let offset=0; ; offset+=200) {
    const {data,error}=await query.order('id').range(offset,offset+199)
    if(error) throw new Error('Could not load expenses.')
    rows.push(...(data ?? []) as Expense[])
    if(!data || data.length<200) return rows
  }
}

export async function getExpense(id: string): Promise<Expense | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('expenses')
    .select('*, project:projects(*)')
    .eq('id', id)
    .single()

  if (error) throw recordError(error.code)
  return data as Expense
}

export async function createExpense(input: CreateExpenseInput, requestId = crypto.randomUUID()): Promise<Expense> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.rpc('create_money_record', { p_kind: 'expenses', p_id: requestId, p_data: input })
  if (error) throw recordError(error.code)
  const { data, error: readError } = await supabase.from('expenses').select('*').eq('id', requestId).single()
  if (readError) throw recordError()
  return data as Expense
}

export async function updateExpense(id: string, input: UpdateExpenseInput, expectedUpdatedAt: string): Promise<Expense> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('expenses')
    .update(input)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select()
    .single()

  if (error) throw recordError(error.code)
  return data as Expense
}

export async function archiveExpense(id: string, expectedUpdatedAt: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('expenses')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select('id').single()

  if (error) throw recordError(error.code)
}

// Upload receipt
export async function uploadReceipt(file: File): Promise<string> {
  const supabase = getSupabaseClient()
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  const maxBytes = 10 * 1024 * 1024

  if (!allowedTypes.has(file.type)) {
    throw new Error('Receipt must be a JPEG, PNG, WebP, or PDF file')
  }

  if (file.size > maxBytes) {
    throw new Error('Receipt must be smaller than 10 MB')
  }

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    throw new Error(userError?.message || 'You must be signed in to upload receipts')
  }

  const extensionByType: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
  }
  const filePath = `${userData.user.id}/${crypto.randomUUID()}.${extensionByType[file.type]}`

  const { error } = await supabase.storage
    .from('receipts')
    .upload(filePath, file, {
      contentType: file.type,
      upsert: false,
    })

  if (error) throw new Error('Could not upload the receipt. Try again.')

  return filePath
}

export async function getReceiptUrl(expense: Expense): Promise<string> {
  const supabase = getSupabaseClient()
  let path = expense.receipt_path
  if (!path && expense.receipt_url) {
    const legacy = new URL(expense.receipt_url)
    const trusted = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!)
    const prefix = '/storage/v1/object/sign/receipts/'
    if (legacy.origin !== trusted.origin || !legacy.pathname.startsWith(prefix)) throw new Error('This receipt reference is not supported.')
    path = decodeURIComponent(legacy.pathname.slice(prefix.length))
  }
  if (!path || path.includes('..') || path.startsWith('/') || path.includes('\\')) throw new Error('No valid receipt is attached.')
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 60)
  if (error) throw new Error('Could not open this receipt. Check your access and try again.')
  return data.signedUrl
}
