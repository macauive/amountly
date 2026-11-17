export function limitInFlight(perUser: number, perProcess: number) {
  const counts = new Map<string, number>()
  let total = 0
  return (userId: string) => {
    const count = counts.get(userId) ?? 0
    if (count >= perUser || total >= perProcess) return null
    counts.set(userId, count + 1)
    total++
    return () => {
      const active = counts.get(userId)!
      if (active === 1) counts.delete(userId)
      else counts.set(userId, active - 1)
      total--
    }
  }
}
