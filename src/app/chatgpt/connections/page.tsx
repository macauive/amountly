export const dynamic = 'force-dynamic'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { requireIdentity } from '@/lib/platform/server'
import { chatgptEnabled } from '@/lib/chatgpt/config'
import { Disconnect } from '@/components/chatgpt/disconnect'
export default async function Page() {
  if (!chatgptEnabled()) notFound()
  try { await requireIdentity(new Headers(await headers())) } catch { redirect('/login') }
  return <main className="mx-auto max-w-lg space-y-6 p-8"><h1 className="text-2xl font-semibold">ChatGPT connection</h1><p>Revoke all ChatGPT read access to this Amountly account. Revocation applies to the next tool request and token refresh. This keeps your financial records and Amountly login.</p><Disconnect /><a href="/dashboard" className="block underline">Return to Amountly</a></main>
}
