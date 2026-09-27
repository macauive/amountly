import { differenceInCalendarDays, parseISO } from 'date-fns'
import { BillStatus } from '@/types/enums'

// Due dates are calendar days, not elapsed 24-hour periods.
export function billDaysUntilDue(dueDate: string, now = new Date()): number {
  return differenceInCalendarDays(parseISO(dueDate.slice(0, 10)), now)
}

export function effectiveBillStatus(bill: { status: BillStatus; due_date: string }, now = new Date()): BillStatus {
  if (bill.status === BillStatus.paid || bill.status === BillStatus.cancelled) return bill.status
  const days = billDaysUntilDue(bill.due_date, now)
  if (!Number.isFinite(days)) return bill.status
  return days < 0 ? BillStatus.overdue : days === 0 ? BillStatus.due : BillStatus.upcoming
}
