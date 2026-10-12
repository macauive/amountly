'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { hasCapability } from '@/lib/capabilities'
import { Capability } from '@/types/enums'
import { expenseSearchRecord,invoiceSearchRecord,billSearchRecord,vendorBillSearchRecord } from '@/lib/search-records'
import { getExpenses } from '@/services/expenses.service'
import { getInvoices } from '@/services/invoices.service'
import { getBills } from '@/services/bills.service'
import { getVendorBills } from '@/services/accounts-payable.service'
import { emptyRecordFilters, recordStatuses, recordStatusLabel, filterRecords, parseRecordFilters, recordsHref, sourceRecordHref, type RecordFilters, type SearchRecord } from '@/lib/record-search'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default function RecordsPage() {
  const {user}=useAuth()
  return <RecordResults key={`${user?.id}:${user?.organization_id}:${user?.account_type}:${user?.role}`} />
}
function RecordResults() {
  const {user}=useAuth(), router=useRouter(), params=useSearchParams()
  const queryString=params?.toString()??'', filters=parseRecordFilters(new URLSearchParams(queryString))
  const form=filters??emptyRecordFilters
  const [records,setRecords]=useState<SearchRecord[]>([])
  const [busy,setBusy]=useState(true), [error,setError]=useState(''), [retry,setRetry]=useState(0)
  useEffect(()=>{
    let active=true
    if(!user)return
    const can=(cap:Capability)=>hasCapability(user.account_type,user.role,cap)
    setRecords([]);setBusy(true);setError('')
    void Promise.all([
      can(Capability.viewOwnExpenses)?getExpenses():Promise.resolve([]),
      can(Capability.viewInvoices)?getInvoices():Promise.resolve([]),
      can(Capability.viewBills)&&user.account_type==='personal'?getBills():Promise.resolve([]),
      can(Capability.viewAccountsPayable)?getVendorBills():Promise.resolve([]),
    ]).then(([expenses,invoices,bills,vendorBills])=>{
      if(!active)return
      setRecords([
        ...expenses.map(expenseSearchRecord), ...invoices.map(invoiceSearchRecord),
        ...bills.map(billSearchRecord), ...vendorBills.map(vendorBillSearchRecord),
      ])
    }).catch(()=>{if(active)setError('Could not load all searchable records. No partial results are shown.')}).finally(()=>{if(active)setBusy(false)})
    return ()=>{active=false}
  },[user?.id,user?.organization_id,user?.account_type,user?.role,retry])
  const results=filterRecords(records,filters), scope=filters?recordsHref(filters):'/records'
  const search=(next:RecordFilters)=>{if(next.start&&next.end&&next.start>next.end){setError('Choose a From date before the Through date.');return}setError('');router.replace(recordsHref(next),{scroll:false})}
  return <section className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
    <div><h1 className="text-2xl font-bold">Find financial records</h1><p className="mt-1 text-sm text-muted-foreground">Search invoices, bills and expenses you can access. Open a result to inspect its source. No AI processing.</p></div>
    <form className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3" key={queryString} onSubmit={e=>{e.preventDefault();const next=parseRecordFilters(new URLSearchParams([...new FormData(e.currentTarget)].map(([key,value])=>[key,String(value)])));if(next)search(next);else setError('Choose valid filters and a From date before the Through date.')}}>
      <label className="grid gap-1 text-sm sm:col-span-3">Search<input className="rounded-md border bg-background p-2" name="q" defaultValue={form.q} maxLength={100} placeholder="Merchant, invoice number, description or amount" /></label>
      <label className="grid gap-1 text-sm">From<input className="rounded-md border bg-background p-2" type="date" name="start" defaultValue={form.start}/></label>
      <label className="grid gap-1 text-sm">Through<input className="rounded-md border bg-background p-2" type="date" name="end" defaultValue={form.end}/></label>
      <label className="grid gap-1 text-sm">Record type<select className="rounded-md border bg-background p-2" name="kind" defaultValue={form.kind}>{[['all','All records'],['expenses','Expenses'],['invoices','Invoices'],['bills','Personal bills'],['vendor_bills','Supplier bills']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Status<select className="rounded-md border bg-background p-2" name="status" defaultValue={form.status}><option value="all">All statuses</option>{recordStatuses.map(s=><option key={s} value={s}>{recordStatusLabel(s)}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Receipt (expenses)<select className="rounded-md border bg-background p-2" name="receipt" defaultValue={form.receipt}>{[['all','Any'],['attached','Attached'],['missing','Missing receipt']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <div className="flex items-end gap-2"><Button type="submit">Search records</Button><Button type="button" variant="outline" onClick={()=>search(emptyRecordFilters)}>Clear filters</Button></div>
    </form>
    {filters && <div className="flex flex-wrap gap-2" aria-label="Active filters">{Object.entries(filters).filter(([k,v])=>v!==emptyRecordFilters[k as keyof RecordFilters]).map(([key,value])=><Button size="sm" variant="outline" key={key} onClick={()=>search({...filters,[key]:emptyRecordFilters[key as keyof RecordFilters]})} aria-label={`Remove ${key} filter`}>{{q:'Search',start:'From',end:'Through',kind:'Type',status:'Status',receipt:'Receipt'}[key]}: {value} ×</Button>)}</div>}
    {!filters&&<p role="alert">This search link has invalid filters. Clear filters to choose a valid search.</p>}
    {error&&<div role="alert">{error}<Button variant="outline" onClick={()=>setRetry(n=>n+1)}>Try again</Button></div>}
    {busy?<p role="status">Loading accessible records…</p>:!error&&<>
      <p className="text-sm text-muted-foreground">{results.length} matching records · Invoice dates are issue dates; bill dates are due dates.</p>
      <ul className="space-y-3">{results.map(record=><li key={`${record.kind}:${record.id}`}><Card><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="min-w-0"><Link className="break-words font-semibold underline" href={sourceRecordHref(record,scope)}>{record.label}</Link><p className="break-words text-sm text-muted-foreground">{record.detail}</p><p className="mt-1 text-sm">{record.amount.toFixed(2)} {record.currency} · {record.date.slice(0,10)} · {recordStatusLabel(record.status)}</p></div><div className="flex flex-wrap gap-2"><Badge variant="secondary">{record.kind.replace('_',' ')}</Badge>{record.kind==='expenses'&&<Badge variant="outline">{record.receipt?'Receipt attached':'Missing receipt'}</Badge>}</div></CardContent></Card></li>)}</ul>
      {!results.length&&<div className="space-y-3 rounded-xl border p-5"><p>No records match this search and its filters.</p><Button variant="outline" onClick={()=>search({...emptyRecordFilters,q:filters?.q??''})}>Search all records</Button></div>}
    </>}
  </section>
}
