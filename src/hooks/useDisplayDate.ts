'use client'

import { useAuth } from '@/contexts/AuthContext'
import { formatPreferredDate } from '@/lib/date-format'

export function useDisplayDate(includeTime = false) {
  const { user } = useAuth()
  return (value: string | null | undefined) => formatPreferredDate(value, user?.preferences?.date_format, includeTime)
}
