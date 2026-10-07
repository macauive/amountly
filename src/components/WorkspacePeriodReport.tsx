'use client'

import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useDisplayDate } from '@/hooks/useDisplayDate'
import type { Expense, Invoice } from '@/types/models'
import { incomeRecords, expenseRecords, reportPeriod, sumMoney, type IncomeBasis } from '@/lib/reporting'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { AccountType } from '@/types/enums'
import { AccountantPacketExport } from '@/components/AccountantPacketExport'

export function WorkspacePeriodReport({ invoices, expenses, currency, basis, canExport }: {
  invoices: Invoice[]; expenses: Expense[]; currency: string; basis: IncomeBasis; canExport: boolean
}) {
  const { user } = useAuth()
  const displayDate = useDisplayDate()
  const [year, setYear] = useState(new Date().getFullYear())
  const [mode, setMode] = useState('fiscal')
  const preference = Number(user?.preferences?.fiscal_year_start ?? 1)
  const month = mode === 'fiscal' && Number.isInteger(preference) && preference >= 1 && preference <= 12 ? preference : 1
  const period = reportPeriod(year, month)
  const income = incomeRecords(invoices, year, currency, basis, month)
  const captured = expenseRecords(expenses, year, currency, month)
  const money = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
  const rows = [...income.map(row => ({ date: row.date.slice(0,10), type: 'income', name: row.name, amount: row.amount, status: row.status })),
    ...captured.map(row => ({ date: row.expense_date.slice(0,10), type: 'expense', name: row.description || row.merchant || 'Expense', amount: row.amount, status: row.status }))].sort((a,b) => a.date.localeCompare(b.date))
  const downloadUrl = `/api/reports/workspace?${new URLSearchParams({year:String(year),month:String(month),currency,basis})}`
  return <Card><CardHeader><CardTitle>Workspace period report</CardTitle><p className="text-sm text-muted-foreground">Use your saved fiscal start month or a calendar year. This report does not change tax deadlines, filing periods, or the calendar-year tax estimator.</p></CardHeader><CardContent className="space-y-4">
    <div className="flex flex-wrap gap-4"><div><Label htmlFor="workspace-period">Period</Label><select id="workspace-period" className="block rounded border bg-background p-2" value={mode} onChange={event => setMode(event.target.value)}><option value="fiscal">Saved fiscal year</option><option value="calendar">Calendar year</option></select></div><div><Label htmlFor="workspace-start-year">Year the period starts</Label><select id="workspace-start-year" className="block rounded border bg-background p-2" value={year} onChange={event => setYear(Number(event.target.value))}>{Array.from({ length: 101 }, (_, index) => 2000 + index).map(value => <option key={value} value={value}>{value}</option>)}</select></div></div>
    <p className="font-medium">{displayDate(period.start)} – {displayDate(period.end)} · {currency} · {basis === 'cash' ? 'Cash received' : 'Invoices issued'}</p>
    <div className="grid gap-3 sm:grid-cols-2"><p>Income: <strong>{money(sumMoney(income))}</strong></p><p>Captured expenses: <strong>{money(sumMoney(captured))}</strong></p></div>
    <p className="text-sm text-muted-foreground">Uses the currency and income basis selected above. Currencies are never combined. Reversed receipts and draft/cancelled invoices are excluded; legacy Paid labels without receipts do not count as cash. Expenses are captured records, not proof of payment or deductibility.</p>
    {canExport && <div className="flex flex-wrap gap-3">{rows.length ? <Button variant="outline" asChild><a href={downloadUrl} target="_blank" rel="noopener noreferrer">Export workspace period CSV</a></Button>
      : <Button variant="outline" disabled>Export workspace period CSV</Button>}
      {user?.account_type === AccountType.freelancer && !user.organization_id && <AccountantPacketExport key={`${user.id}-${year}-${month}-${currency}-${basis}`} year={year} month={month} start={period.start} end={period.end} currency={currency} basis={basis} disabled={!rows.length} />}
    </div>}
    <div className="max-h-96 overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2">Date</th><th>Record</th><th>Name</th><th className="text-right">Amount ({currency})</th><th className="pl-3">Status</th></tr></thead><tbody>{rows.map((row,index) => <tr key={`${row.type}-${index}`} className="border-b"><td className="whitespace-nowrap py-2 pr-3">{displayDate(row.date)}</td><td className="pr-3">{row.type}</td><td className="pr-3">{row.name}</td><td className="text-right">{money(row.amount)}</td><td className="pl-3">{row.status}</td></tr>)}</tbody></table>{!rows.length && <p className="py-3">No matching records in this period.</p>}</div>
  </CardContent></Card>
}
