import type { User as AuthUser } from '@supabase/supabase-js'
import { getSupabaseClient } from '@/lib/supabase'
import type { User } from '@/types/models'
import { AccountType } from '@/types/enums'

// Called after authentication. RLS validates identity/email. Metadata is used
// only for a display name, never for role, membership or active status.
export async function ensureOwnProfile(authUser: AuthUser, accountType: AccountType): Promise<User> {
  if (![AccountType.personal, AccountType.freelancer, AccountType.business].includes(accountType)) throw new Error('Choose a valid account type.')
  const supabase = getSupabaseClient()
  const read = () => supabase.from('users').select('*').eq('id', authUser.id).maybeSingle()
  const existing = await read()
  if (existing.error) throw new Error('Could not load your profile. Please try again.')
  if (existing.data) return existing.data as User
  const name = typeof authUser.user_metadata?.name === 'string' ? authUser.user_metadata.name.trim().slice(0, 120) : ''
  const created = await supabase.from('users').insert({
    id: authUser.id, email: authUser.email, name: name || 'New user',
    role: 'MEMBER', account_type: accountType, organization_id: null,
  }).select('*').single()
  if (!created.error && created.data) return created.data as User
  // Multiple tabs can initialize the profile concurrently; never upsert over
  // an existing role or workspace to recover from that conflict.
  if (created.error?.code === '23505') {
    const retried = await read()
    if (!retried.error && retried.data) return retried.data as User
  }
  throw new Error('Could not finish setting up your profile. Please try again.')
}
