type TrackedTime = { start_at: string; duration_minutes?: number | null }
const dayMilliseconds = 86_400_000

export function weeklyTime(entries: TrackedTime[], now = new Date(), requestedTimezone?: string) {
  let timeZone = requestedTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(now) }
  catch { timeZone = 'UTC' }
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' })
  const calendarDay = (date: Date) => {
    const parts = formatter.formatToParts(date)
    const part = (type: string) => Number(parts.find(value => value.type === type)?.value)
    return Date.UTC(part('year'), part('month') - 1, part('day'))
  }
  const today = calendarDay(now)
  const start = today - ((new Date(today).getUTCDay() + 6) % 7) * dayMilliseconds
  const endExclusive = start + 7 * dayMilliseconds
  let minutes = 0
  for (const entry of entries) {
    const timestamp = new Date(entry.start_at)
    const duration = entry.duration_minutes
    if (!Number.isFinite(timestamp.getTime()) || typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) continue
    const day = calendarDay(timestamp)
    // Attribute an entry's recorded duration to its start day, like the list.
    if (day >= start && day < endExclusive) minutes += duration
  }
  return { minutes, timeZone, start: new Date(start).toISOString().slice(0,10), end: new Date(endExclusive - dayMilliseconds).toISOString().slice(0,10) }
}
