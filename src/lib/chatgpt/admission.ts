import { createHash } from 'node:crypto'
import { AiHttpError } from '@/lib/ai/server'

// Anonymous input never creates durable counters or a shared minute-long debt.
// Eviction bounds memory without refusing a previously unseen valid credential.
export function createAdmissionLimiter(maxEntries = 1024, maxActive = 8) {
  const attempts = new Map<string, { start: number; count: number }>()
  let active = 0
  return async function admit<T>(input: string, work: () => Promise<T>): Promise<T> {
    const now = Date.now(), key = createHash('sha256').update(input).digest('hex')
    for (const [id, row] of attempts) if (now - row.start >= 60000) attempts.delete(id)
    const row = attempts.get(key)
    if (row && row.count >= 120) throw new AiHttpError(429, 'Too many requests. Try again shortly.')
    if (active >= maxActive) throw new AiHttpError(429, 'Too many requests. Try again shortly.')
    if (!row && attempts.size >= maxEntries) attempts.delete(attempts.keys().next().value!)
    attempts.set(key, { start: row?.start ?? now, count: (row?.count ?? 0) + 1 })
    active++
    try { return await work() } finally { active-- }
  }
}

export const admitIntegrationRequest = createAdmissionLimiter()

// Better Auth otherwise falls back to a shared per-path IP bucket when there
// is no trusted peer address. These routes have bounded capability admission
// and durable proven-owner quotas instead; browser sign-in limits stay enabled.
export const oauthRateRules = {
  '/oauth2/authorize': false, '/oauth2/token': false,
  '/oauth2/revoke': false, '/oauth2/consent': false,
} as const
