'use client'
import { dateInputValue } from '@/lib/date-format'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { z } from 'zod/v3'
import { getSupabaseClient } from '@/lib/supabase'
import { expenseCategoryLabels } from '@/types/enums'
import { safeReturnHref,recordStatusLabel } from '@/lib/record-search'
import { expenseHref } from '@/lib/expense-navigation'
import { recordQuerySchema } from '@/lib/financial-review/service'
import { getExpense } from '@/services/expenses.service'
import type { Expense } from '@/types/models'
import { ReceiptDocument } from '@/components/ReceiptDocument'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
const summarySchema=z.object({id:z.string().uuid(),kind:recordQuerySchema.shape.kind,label:z.string().max(160),amount:z.number().finite(),currency:z.string().max(8),status:z.string().max(40),date:z.string().date(),receiptAttached:z.boolean().optional()}).strict()

export function FinancialReviewRecord({kind,id,returnTo}:{kind:string;id:string;returnTo?:string}) {
  const {user}=useAuth()
  return <RecordDetail key={`${user?.id}:${user?.organization_id}:${kind}:${id}`} kind={kind} id={id} returnTo={returnTo}/>
}
function RecordDetail({kind,id,returnTo}:{kind:string;id:string;returnTo?:string}) {
  const [record,setRecord]=useState<z.infer<typeof summarySchema>|null>(null),[expense,setExpense]=useState<Expense|null>(null),[error,setError]=useState('')
  const back=safeReturnHref(returnTo,'/financial-review')
  useEffect(()=>{
    let active=true
    void(async()=>{
      try {
        const query=recordQuerySchema.parse({kind,id})
        const {data}=await getSupabaseClient().auth.getSession()
        if(!data.session)throw new Error()
        const response=await fetch('/api/financial-review/record',{method:'POST',headers:{'Content-Type':'application/json',...(data.session.access_token?{Authorization:`Bearer ${data.session.access_token}`}:{})},body:JSON.stringify(query),cache:'no-store'})
        if(!response.ok)throw new Error()
        const result=summarySchema.parse(await response.json())
        if(result.id!==id||result.kind!==kind)throw new Error()
        const original=kind==='expenses'?await getExpense(id):null
        if(original&&(original.id!==id||original.archived_at))throw new Error()
        const current=original?summarySchema.parse({...result,label:(original.description||original.merchant||'Expense').slice(0,160),amount:original.amount,currency:original.currency,status:original.status,date:dateInputValue(original.expense_date),receiptAttached:!!(original.receipt_path||original.receipt_url)}):result
        if(active){setRecord(current);setExpense(original)}
      } catch {if(active)setError('This record is unavailable or outside your access.')}
    })()
    return()=>{active=false}
  },[kind,id])
  const hasOriginal=!!(expense?.receipt_path||expense?.receipt_url)
  const correction=record?.kind==='expenses'?expenseHref(id):record?.kind==='invoices'?`/invoices/${id}`:record?`/bills?bill=${encodeURIComponent(id)}`:null
  return <section className="mx-auto max-w-6xl space-y-5 p-4 sm:p-8">
    <Link href={back} className="text-sm underline">Back to {back.startsWith('/records')?'results':'review'}</Link>
    <h1 className="text-2xl font-semibold">Review financial record</h1>
    {error?<p role="alert">{error}</p>:!record?<p role="status">Loading record…</p>:<div className={`grid min-w-0 gap-6 ${hasOriginal?'lg:grid-cols-2':''}`}>
      {hasOriginal&&expense&&<ReceiptDocument source={{expense}}/>}
      <div className="min-w-0 space-y-4 rounded-xl border bg-card p-5"><h2 className="break-words text-xl font-semibold">{record.label}</h2><p className="text-sm">Recorded status: <Badge variant="secondary">{recordStatusLabel(record.status)}</Badge></p>
        <dl className="grid grid-cols-2 gap-3 text-sm"><dt>Recorded amount</dt><dd>{record.amount.toFixed(2)} {record.currency}</dd><dt>Date</dt><dd>{record.date}</dd><dt>Record type</dt><dd>{record.kind.replace('_',' ')}</dd>{expense&&<><dt>Merchant</dt><dd>{typeof expense.merchant==='string'?expense.merchant:'Unavailable'}</dd><dt>Category</dt><dd>{expenseCategoryLabels[expense.category]??'Unavailable'}</dd></>}</dl>
        {record.receiptAttached!==undefined&&<p className="text-sm">{record.receiptAttached?'Original receipt attached':'Missing receipt: attach the original when correcting this expense.'}</p>}
        <p className="text-sm text-muted-foreground">Compare the saved fields with the original before confirming a review. Changes are made on the source record and keep its existing history.</p>
        {correction&&<Button asChild><Link href={`${correction}${correction.includes('?')?'&':'?'}returnTo=${encodeURIComponent(back)}`}>Open exact record</Link></Button>}
      </div>
    </div>}
  </section>
}
