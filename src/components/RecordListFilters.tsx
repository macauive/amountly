'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { parseRecordFilters, recordFilterParams, emptyRecordFilters, recordStatusLabel, type SearchRecord, filterRecords } from '@/lib/record-search'
import { Button } from '@/components/ui/button'

export function useRecordListFilters<T>(rows: readonly T[], map: (row:T)=>SearchRecord) {
  const params=useSearchParams(), filters=parseRecordFilters(new URLSearchParams(params?.toString()??''))
  let entries: {row:T;record:SearchRecord}[]
  try{entries=rows.map(row=>({row,record:map(row)}))}catch{return{rows:[] as T[],invalid:true}}
  const matches=new Set(filterRecords(entries.map(entry=>entry.record),filters).map(record=>record.id))
  return{rows:entries.filter(entry=>matches.has(entry.record.id)).map(entry=>entry.row),invalid:false}
}
export function RecordListFilters({statuses,invalid=false}:{statuses:readonly string[];invalid?:boolean}) {
  const params=useSearchParams(),router=useRouter()
  const current=parseRecordFilters(new URLSearchParams(params?.toString()??''))
  return <form className="space-y-3 rounded-xl border p-4" onSubmit={e=>{
    e.preventDefault();const data=new FormData(e.currentTarget)
    const next=parseRecordFilters(new URLSearchParams({q:String(data.get('q')??''),start:String(data.get('start')??''),end:String(data.get('end')??''),status:String(data.get('status')??'all')}))
    if(!next)return
    const query=recordFilterParams(next)
    if(params?.get('returnTo'))query.set('returnTo',params.get('returnTo')!)
    router.replace(`${window.location.pathname}${query.size?'?'+query:''}`,{scroll:false})
  }}>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" key={params?.toString()}>
      <label className="grid gap-1 text-sm">Search<input name="q" className="rounded border bg-background p-2" maxLength={100} defaultValue={current?.q??''} placeholder="Name, number or amount"/></label>
      <label className="grid gap-1 text-sm">From<input name="start" type="date" className="rounded border bg-background p-2" defaultValue={current?.start??''}/></label>
      <label className="grid gap-1 text-sm">Through<input name="end" type="date" className="rounded border bg-background p-2" defaultValue={current?.end??''}/></label>
      <label className="grid gap-1 text-sm">Status<select name="status" className="rounded border bg-background p-2" defaultValue={current?.status??'all'}><option value="all">All statuses</option>{statuses.map(s=><option key={s} value={s}>{recordStatusLabel(s)}</option>)}</select></label>
    </div>
    <div className="flex flex-wrap gap-2"><Button size="sm" type="submit">Filter records</Button><Button size="sm" type="button" variant="ghost" onClick={()=>router.replace(window.location.pathname,{scroll:false})}>Clear filters</Button></div>
    {invalid&&<p role="alert">Some records could not be validated. This list is unavailable; reload and try again.</p>}
    {!current&&<p role="alert">These filters are invalid. Clear filters to search again.</p>}
    {current&&<p className="text-sm text-muted-foreground">{Object.entries(current).filter(([key,value])=>value!==emptyRecordFilters[key as keyof typeof current]).map(([key,value])=>`${key}: ${value}`).join(' · ')||'All records'} · Summary totals include all records.</p>}
  </form>
}
