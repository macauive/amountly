import { getSupabaseClient } from '@/lib/supabase'

export interface RecordEvent {
  id: string; record_type: string; record_id: string; action: string
  previous_values?: Record<string, string | number | null>; next_values: Record<string, string | number | null>
  previous_status?: string; next_status?: string; changed_fields: string[]; created_at: string
}

export class RecordSaveError extends Error {
  constructor(message: string, readonly outcome: 'rejected' | 'unknown') { super(message) }
}

export function recordError(code?: string): RecordSaveError {
  const rejected = !!code && (/^(22|23|42)/.test(code) || code === 'PT409')
  return new RecordSaveError(code === 'PT409' || code === '23505' ? 'This record changed or may be a duplicate. Reload and review before retrying.'
    : code === '42501' ? 'You do not have permission to change this record.'
      : rejected ? 'Check the fields and current status before trying again.'
        : 'Could not confirm the change. Retry the original request to check its status.', rejected ? 'rejected' : 'unknown')
}

export async function reviewWorkRecord(kind: 'expenses' | 'time_entries', id: string, action: 'submit' | 'approve' | 'reject', updatedAt: string) {
  const { error } = await getSupabaseClient().rpc('review_work_record', { p_kind: kind, p_id: id, p_action: action, p_expected_updated_at: updatedAt })
  if (error) throw recordError(error.code)
}

export async function setExpenseReview(id: string, reviewed: boolean, expectedUpdatedAt: string): Promise<void> {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    || typeof reviewed !== 'boolean' || typeof expectedUpdatedAt !== 'string' || expectedUpdatedAt.length > 64
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(expectedUpdatedAt)
    || !Number.isFinite(Date.parse(expectedUpdatedAt))) throw recordError('22023')
  const { error } = await getSupabaseClient().rpc('set_expense_review', {
    p_id: id, p_reviewed: reviewed, p_expected_updated_at: expectedUpdatedAt,
  })
  if (error) throw recordError(error.code)
}

export async function getRecordHistory(kind: string, id: string): Promise<RecordEvent[]> {
  const rows: RecordEvent[] = []
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await getSupabaseClient().from('record_events').select('*').eq('record_type', kind).eq('record_id', id).order('created_at', { ascending: false }).order('id').range(offset, offset + 199)
    if (error) throw new Error('Could not load record history.')
    rows.push(...(data ?? []) as RecordEvent[])
    if (!data || data.length < 200) return rows
  }
}
