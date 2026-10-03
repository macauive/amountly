export const dynamic = 'force-dynamic'
import { ConnectionForm } from '@/components/chatgpt/connection-form'
import { validateSignedQuery, signedSearchParams } from '@/lib/chatgpt/query'
import { chatgptEnabled } from '@/lib/chatgpt/config'
import { notFound } from 'next/navigation'
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!chatgptEnabled()) notFound()
  const params = await searchParams
  let query: string
  try {
    query = await validateSignedQuery(signedSearchParams(params))
  } catch { return <main className="mx-auto max-w-md p-8"><h1 className="text-2xl font-semibold">Connection request expired</h1><p className="mt-4">Start account linking again in ChatGPT.</p></main> }
  return <main className="mx-auto max-w-md space-y-6 p-8"><h1 className="text-2xl font-semibold">Connect Amountly to ChatGPT</h1><p>Sign in to review the permissions before linking your account.</p><ConnectionForm query={query} /></main>
}
