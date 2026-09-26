import { getSupabaseClient } from '@/lib/supabase'

export interface WorkspaceContact {
  contact_key: string
  id: string
  kind: 'client' | 'vendor'
  name: string
  email?: string
  phone?: string
  city?: string
  country?: string
  archived_at?: string
}

export async function getWorkspaceContacts(): Promise<WorkspaceContact[]> {
  const rows: WorkspaceContact[] = []
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await getSupabaseClient().from('workspace_contacts')
      .select('*').order('name').order('contact_key').range(offset, offset + 199)
    if (error) throw new Error('Could not load contacts.')
    rows.push(...(data ?? []) as WorkspaceContact[])
    if (!data || data.length < 200) return rows
  }
}
