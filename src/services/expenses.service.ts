import { getSupabaseClient } from '@/lib/supabase'
import type { Expense, CreateExpenseInput, UpdateExpenseInput } from '@/types/models'

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

  const { data, error } = await query

  if (error) throw error
  return data as Expense[]
}

export async function getExpense(id: string): Promise<Expense | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('expenses')
    .select('*, project:projects(*)')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as Expense
}

export async function createExpense(input: CreateExpenseInput): Promise<Expense> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('expenses')
    .insert(input)
    .select()
    .single()

  if (error) throw error
  return data as Expense
}

export async function updateExpense(id: string, input: UpdateExpenseInput): Promise<Expense> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('expenses')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as Expense
}

export async function deleteExpense(id: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', id)

  if (error) throw error
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

  if (error) throw error

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
