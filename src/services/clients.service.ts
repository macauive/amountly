import { getSupabaseClient } from '@/lib/supabase'
import type { Client, CreateClientInput, UpdateClientInput } from '@/types/models'

export interface ClientFilters {
  userId?: string
  organizationId?: string | null
}

export async function getClients(filters?: ClientFilters): Promise<Client[]> {
  const supabase = getSupabaseClient()
  let query = supabase
    .from('clients')
    .select('*')
    .is('archived_at', null)
    .order('name')

  if (filters?.organizationId) {
    query = query.eq('organization_id', filters.organizationId)
  } else if (filters?.userId) {
    query = query.eq('user_id', filters.userId)
  }

  const { data, error } = await query

  if (error) throw error
  return data as Client[]
}

export async function getClient(id: string): Promise<Client | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as Client
}

export async function createClient(input: CreateClientInput): Promise<Client> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('clients')
    .insert(input)
    .select()
    .single()

  if (error) throw error
  return data as Client
}

export async function updateClient(id: string, input: UpdateClientInput): Promise<Client> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('clients')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as Client
}

export async function archiveClient(id: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('clients')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .single()

  if (error) throw error
}
