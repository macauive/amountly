// Enable only alongside reviewed database commands in a future release.
export const showAdvancedModules = false

export type DeferredModuleKey = 'accounting' | 'payroll' | 'inventory' | 'team'

export const deferredModuleDetails: Record<DeferredModuleKey, {
  title: string
  description: string
  focus: string[]
}> = {
  accounting: {
    title: 'Full accounting is deferred',
    description: 'Journal entries, chart of accounts, and reconciliation are powerful, but they make Amountly feel like traditional accounting software before the core workflow is finished.',
    focus: ['Dashboard next steps', 'Bills and expenses', 'Tax Prep exports'],
  },
  payroll: {
    title: 'Payroll is deferred',
    description: 'Payroll adds compliance, employee records, and tax obligations that should wait until the main money-in and money-out workflow feels complete.',
    focus: ['Invoices and payments', 'Bills and expenses', 'Clean monthly records'],
  },
  inventory: {
    title: 'Inventory is deferred',
    description: 'Inventory management is useful for product businesses, but it broadens Amountly beyond simple accounting for the first production version.',
    focus: ['Expense capture', 'Vendor bills', 'Tax-ready categories'],
  },
  team: {
    title: 'Team management is deferred',
    description: 'Roles, permissions, and approvals can come later. V1 should stay centered on one person or one small business keeping financial records clear.',
    focus: ['Client and project records', 'Invoice follow-up', 'Monthly close'],
  },
}
