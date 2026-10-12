'use client'
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { emptyRecordFilters, recordsHref } from '@/lib/record-search'
export function RecordSearch() {
  const router=useRouter(), params=useSearchParams()
  const [query,setQuery]=useState(params?.get('q')?.slice(0,100) ?? '')
  useEffect(()=>{setQuery(params?.get('q')?.slice(0,100) ?? '')},[params])
  return <form role="search" className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-2xl" onSubmit={event=>{event.preventDefault();router.push(recordsHref({...emptyRecordFilters,q:query}))}}>
    <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"/><Input aria-label="Search financial records" placeholder="Search records…" maxLength={100} value={query} onChange={event=>setQuery(event.target.value)} className="h-9 pl-9"/></div>
    <Button type="submit" size="sm" variant="outline">Find</Button>
  </form>
}
