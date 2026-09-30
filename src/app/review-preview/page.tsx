import { notFound } from 'next/navigation'
import { FinancialReview } from '@/components/FinancialReview'
export default function ReviewPreview() {
  if (process.env.NODE_ENV !== 'development' || process.env.AMOUNTLY_REVIEW_MODE !== 'synthetic') notFound()
  return <FinancialReview synthetic />
}
