import { getSupabaseClient } from '@/lib/supabase'
import type { TimeEntry, CreateTimeEntryInput, UpdateTimeEntryInput } from '@/types/models'
import { TimeEntrySource } from '@/types/enums'

export interface TimeEntryFilters {
  startDate?: string
  endDate?: string
  projectId?: string
  status?: string
}

export async function getTimeEntries(filters?: TimeEntryFilters): Promise<TimeEntry[]> {
  const supabase = getSupabaseClient()
  let query = supabase
    .from('time_entries')
    .select('*, project:projects(*), task:tasks(*), billing_links:invoice_time_links(invoice_id,released_at)')
    .order('start_at', { ascending: false }).order('id')

  if (filters?.startDate) {
    query = query.gte('start_at', filters.startDate)
  }
  if (filters?.endDate) {
    query = query.lte('start_at', filters.endDate)
  }
  if (filters?.projectId) {
    query = query.eq('project_id', filters.projectId)
  }
  if (filters?.status) {
    query = query.eq('status', filters.status)
  }

  const rows: TimeEntry[] = []
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await query.range(offset, offset + 199)
    if (error) throw new Error('Could not load time entries. Please try again.')
    rows.push(...(data ?? []) as TimeEntry[])
    if (!data || data.length < 200) break
  }
  return rows
}

export async function getTimeEntry(id: string): Promise<TimeEntry | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('time_entries')
    .select('*, project:projects(*), task:tasks(*)')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as TimeEntry
}

export async function createTimeEntry(input: Omit<CreateTimeEntryInput, 'source'>): Promise<TimeEntry> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('time_entries')
    .insert({ ...input, source: TimeEntrySource.web })
    .select()
    .single()

  if (error) throw error
  return data as TimeEntry
}

export async function updateTimeEntry(id: string, input: UpdateTimeEntryInput): Promise<TimeEntry> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('time_entries')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as TimeEntry
}

export async function deleteTimeEntry(id: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('time_entries')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// Helper to calculate duration
export function calculateDuration(startAt: string, endAt: string): number {
  const start = new Date(startAt)
  const end = new Date(endAt)
  return Math.round((end.getTime() - start.getTime()) / 60000) // minutes
}
