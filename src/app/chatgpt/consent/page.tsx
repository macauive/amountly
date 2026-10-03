export const dynamic = 'force-dynamic'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { requireIdentity } from '@/lib/platform/server'
import { validateSignedQuery, signedSearchParams } from '@/lib/chatgpt/query'
import { chatgptEnabled } from '@/lib/chatgpt/config'
import { ConnectionForm } from '@/components/chatgpt/connection-form'
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!chatgptEnabled()) notFound()
  let query: string
  try {
    const params = await searchParams
    query = await validateSignedQuery(signedSearchParams(params))
    await requireIdentity(new Headers(await headers()))
  } catch { return <main className="mx-auto max-w-md p-8"><h1 className="text-2xl font-semibold">Connection request expired</h1><p className="mt-4">Sign in and start account linking again in ChatGPT.</p></main> }
  const scopes = new URLSearchParams(query).get('scope')?.split(' ') ?? []
  return <main className="mx-auto max-w-lg space-y-6 p-8"><h1 className="text-2xl font-semibold">Allow ChatGPT to read Amountly?</h1>
    <p>ChatGPT can review the financial records you are currently allowed to view in Amountly. Your account and organization permissions still apply.</p>
    <ul className="list-disc space-y-2 pl-5"><li>Read invoice balances, bills due, expense totals and receipt-presence flags.</li><li>Open supporting record summaries and links.</li>{scopes.includes('email') && <li>Read your verified email to identify this connection.</li>}{scopes.includes('offline_access') && <li>Keep the connection active using rotating tokens for up to seven days.</li>}</ul>
    <p>This connection cannot edit or delete records, send messages, make payments, trade, or file taxes. Raw descriptions, receipt files and customer identifiers are excluded from tool responses.</p>
    <p>Financial summaries are shared with OpenAI when you use the tools. Disconnect at any time from <a className="underline" href="/chatgpt/connections">Amountly connections</a>.</p>
    <ConnectionForm query={query} consent /><p className="text-sm"><a href="/privacy" className="underline">Privacy</a> · <a href="/terms" className="underline">Terms</a> · <a href="/support" className="underline">Support</a></p>
  </main>
}
