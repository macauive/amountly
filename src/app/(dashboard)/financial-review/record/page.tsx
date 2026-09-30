import { FinancialReviewRecord } from '@/components/FinancialReviewRecord'
export default async function RecordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  return <FinancialReviewRecord kind={typeof params.kind === 'string' ? params.kind : ''} id={typeof params.id === 'string' ? params.id : ''} />
}
