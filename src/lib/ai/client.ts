import { getSupabaseClient } from '@/lib/supabase'

type AiResponse<T> = {
  result: T
  safety: {
    redacted: boolean
  }
}

export async function runAiTask<T>(task: string, payload: unknown): Promise<T> {
  const { data: { session }, error } = await getSupabaseClient().auth.getSession()
  if (error || !session?.access_token) throw new Error('Sign in to use AI')
  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ task, payload }),
  })

  const body = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(body?.error || 'AI request failed')
  }

  return (body as AiResponse<T>).result
}
