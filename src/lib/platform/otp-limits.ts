import { createHmac, randomInt } from 'node:crypto'
import type { Pool } from 'pg'
import { requiredSecret } from '@/lib/platform/config'

const windowSeconds = 15 * 60
const limits = {
  'reset-send': { max: 5, cooldown: 30 },
  'signup-send': { max: 5, cooldown: 30 },
  'signup-verify': { max: 10, cooldown: 0 },
  'reset-verify': { max: 10, cooldown: 0 },
} as const

export async function reserveOtp(pool: Pool, email: string, operation: keyof typeof limits) {
  const { max, cooldown } = limits[operation]
  const key = createHmac('sha256', requiredSecret('BETTER_AUTH_SECRET'))
    .update('amountly:otp-limit:').update(email).digest('hex')

  // Prune expired keys in small batches, without locking active buckets.
  if (randomInt(16) === 0) await pool.query(`
    delete from amountly_auth.otp_limits where (email_key, operation) in (
      select email_key, operation from amountly_auth.otp_limits
      where expires_at < statement_timestamp() order by expires_at limit 64 for update skip locked
    )
  `)

  // Reserve before touching a code. An atomic upsert bounds concurrent callers
  // across instances, and sending a new code cannot change the verify bucket.
  const result = await pool.query(`
    insert into amountly_auth.otp_limits as bucket (email_key, operation, used, expires_at, next_at)
    values ($1, $2, 1, statement_timestamp() + $3::integer * interval '1 second',
      statement_timestamp() + $4::integer * interval '1 second')
    on conflict (email_key, operation) do update set
      used = case when bucket.expires_at <= statement_timestamp() then 1 else bucket.used + 1 end,
      expires_at = case when bucket.expires_at <= statement_timestamp() then excluded.expires_at else bucket.expires_at end,
      next_at = excluded.next_at
    where bucket.expires_at <= statement_timestamp()
      or (bucket.used < $5 and ($4::integer = 0 or bucket.next_at <= statement_timestamp()))
    returning 1
  `, [key, operation, windowSeconds, cooldown, max])
  return result.rowCount === 1
}
