// Local-development persistence only. A production worker needs transactional
// database storage and a verified event source before customer-data enablement.
import { mkdir, readFile, writeFile, rename, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { prepareFollowThrough, type FollowThroughState } from '@/lib/financial-review/events'
import type { FinancialReview } from '@/lib/financial-review/calculate'

const stateSchema = z.object({ accountId: z.string().uuid(), enabled: z.boolean(), seen: z.array(z.string().uuid()).max(5000),
  versions: z.record(z.number().int().positive()), drafts: z.array(z.object({ id: z.string().uuid(), sourceId: z.string().max(100),
    title: z.string().max(100), body: z.string().max(10000), status: z.literal('needs_review') })).max(5000) }).strict()
export async function updateLocalReviewJournal(directory: string, accountIdInput: string,
  update: { enabled: boolean } | { event: unknown; review: FinancialReview }): Promise<FollowThroughState> {
  const accountId = z.string().uuid().parse(accountIdInput)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const lock = join(directory, `${accountId}.lock`), file = join(directory, `${accountId}.json`)
  // Exclusive per-account lock: concurrent processing fails safely instead of
  // racing the replay cursor. Never expire a lock that could still be in use.
  await mkdir(lock, { mode: 0o700 })
  try {
    let state: FollowThroughState = { accountId, enabled: false, seen: [], versions: {}, drafts: [] }
    try { state = stateSchema.parse(JSON.parse(await readFile(file, 'utf8'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (state.accountId !== accountId) throw new Error('Review journal account mismatch')
    state = 'enabled' in update ? { ...state, enabled: z.boolean().parse(update.enabled) } : prepareFollowThrough(state, update.event, update.review)
    stateSchema.parse(state)
    const temporary = join(directory, `${accountId}.${randomUUID()}.tmp`)
    await writeFile(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 })
    await rename(temporary, file)
    return state
  } finally { await rmdir(lock) }
}
