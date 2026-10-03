import { usesRenderBackend } from '@/lib/platform/config'
import { authPool } from '@/lib/platform/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    if (usesRenderBackend) {
      const [data] = await Promise.all([
        fetch('http://127.0.0.1:3002/ready', { signal: AbortSignal.timeout(3000), cache: 'no-store' }),
        authPool().query('select 1 from amountly_auth."user" limit 0'),
      ])
      if (!data.ok) throw new Error('Backend unavailable')
    }
    return Response.json({ status: 'ok' }, { headers })
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers })
  }
}
