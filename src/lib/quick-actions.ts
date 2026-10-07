import { CreditCard, Clock, FileText, Receipt, DollarSign } from 'lucide-react'
import { AccountType } from '@/types/enums'
import { receiptUploadHref } from '@/lib/expense-navigation'

export interface QuickAction {
  id: string
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  href: string
  /** Solid color used by FAB circular buttons */
  bg: string
  /** Icon color used by FAB circular buttons */
  iconColor: string
  /** Light pastel style used by dashboard cards */
  cardBg: string
  /** Icon color used by dashboard cards */
  cardIconColor: string
}

const personalActions: QuickAction[] = [
  {
    id: 'pay-bill',
    label: 'Pay Bill',
    description: 'Record a bill payment',
    icon: CreditCard,
    href: '/bills',
    bg: 'bg-blue-800',
    iconColor: 'text-blue-100',
    cardBg: 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-950 dark:hover:bg-blue-900',
    cardIconColor: 'text-blue-600 dark:text-blue-400',
  },
  {
    id: 'add-expense',
    label: 'Add Expense',
    description: 'Record an expense',
    icon: Receipt,
    href: '/expenses',
    bg: 'bg-green-700',
    iconColor: 'text-green-100',
    cardBg: 'bg-green-50 hover:bg-green-100 dark:bg-green-950 dark:hover:bg-green-900',
    cardIconColor: 'text-green-600 dark:text-green-400',
  },
  {
    id: 'add-bill',
    label: 'Add Bill',
    description: 'Add a new bill',
    icon: FileText,
    href: '/bills',
    bg: 'bg-teal-700',
    iconColor: 'text-teal-100',
    cardBg: 'bg-teal-50 hover:bg-teal-100 dark:bg-teal-950 dark:hover:bg-teal-900',
    cardIconColor: 'text-teal-600 dark:text-teal-400',
  },
  {
    id: 'record-payment',
    label: 'Record Payment',
    description: 'Log a payment made',
    icon: DollarSign,
    href: '/bills',
    bg: 'bg-orange-700',
    iconColor: 'text-orange-100',
    cardBg: 'bg-orange-50 hover:bg-orange-100 dark:bg-orange-950 dark:hover:bg-orange-900',
    cardIconColor: 'text-orange-600 dark:text-orange-400',
  },
]

const uploadReceiptAction: QuickAction = {
  id: 'add-expense',
  label: 'Upload a receipt',
  description: 'Review a captured expense draft',
  icon: Receipt,
  href: receiptUploadHref,
  bg: 'bg-green-700',
  iconColor: 'text-green-100',
  cardBg: 'bg-green-50 hover:bg-green-100 dark:bg-green-950 dark:hover:bg-green-900',
  cardIconColor: 'text-green-600 dark:text-green-400',
}

const freelancerActions: QuickAction[] = [
  uploadReceiptAction,
  {
    id: 'log-time',
    label: 'Log Time',
    description: 'Track your work hours',
    icon: Clock,
    href: '/time-entries',
    bg: 'bg-purple-700',
    iconColor: 'text-purple-100',
    cardBg: 'bg-purple-50 hover:bg-purple-100 dark:bg-purple-950 dark:hover:bg-purple-900',
    cardIconColor: 'text-purple-600 dark:text-purple-400',
  },
  {
    id: 'create-invoice',
    label: 'Create Invoice',
    description: 'Bill your clients',
    icon: FileText,
    href: '/invoices',
    bg: 'bg-blue-800',
    iconColor: 'text-blue-100',
    cardBg: 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-950 dark:hover:bg-blue-900',
    cardIconColor: 'text-blue-600 dark:text-blue-400',
  },
  {
    id: 'record-payment',
    label: 'Record Payment',
    description: 'Log a payment received',
    icon: DollarSign,
    href: '/invoices',
    bg: 'bg-orange-700',
    iconColor: 'text-orange-100',
    cardBg: 'bg-orange-50 hover:bg-orange-100 dark:bg-orange-950 dark:hover:bg-orange-900',
    cardIconColor: 'text-orange-600 dark:text-orange-400',
  },
]

const businessActions: QuickAction[] = [
  uploadReceiptAction,
  {
    id: 'create-invoice',
    label: 'Create Invoice',
    description: 'Bill your clients',
    icon: FileText,
    href: '/invoices',
    bg: 'bg-blue-800',
    iconColor: 'text-blue-100',
    cardBg: 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-950 dark:hover:bg-blue-900',
    cardIconColor: 'text-blue-600 dark:text-blue-400',
  },
  {
    id: 'new-bill',
    label: 'New Bill',
    description: 'Add a vendor bill',
    icon: CreditCard,
    href: '/bills',
    bg: 'bg-indigo-800',
    iconColor: 'text-indigo-100',
    cardBg: 'bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950 dark:hover:bg-indigo-900',
    cardIconColor: 'text-indigo-600 dark:text-indigo-400',
  },
  {
    id: 'record-payment',
    label: 'Record Payment',
    description: 'Log a payment received',
    icon: DollarSign,
    href: '/invoices',
    bg: 'bg-orange-700',
    iconColor: 'text-orange-100',
    cardBg: 'bg-orange-50 hover:bg-orange-100 dark:bg-orange-950 dark:hover:bg-orange-900',
    cardIconColor: 'text-orange-600 dark:text-orange-400',
  },
]

export function getQuickActions(accountType: AccountType): QuickAction[] {
  switch (accountType) {
    case AccountType.personal:
      return personalActions
    case AccountType.freelancer:
      return freelancerActions
    case AccountType.business:
      return businessActions
    default:
      return personalActions
  }
}
