'use client'

import { useEffect, useRef, useState } from 'react'
import type { IncomeBasis } from '@/lib/reporting'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

class PacketDownloadError extends Error {}

export function AccountantPacketExport({year,month,start,end,currency,basis,disabled}: {
  year:number; month:number; start:string; end:string; currency:string; basis:IncomeBasis; disabled:boolean
}) {
  const [open,setOpen] = useState(false)
  const [from,setFrom] = useState(start)
  const [through,setThrough] = useState(end)
  const [pending,setPending] = useState(false)
  const [error,setError] = useState('')
  const [complete,setComplete] = useState(false)
  const alive = useRef(true)
  const request = useRef<AbortController|null>(null)
  useEffect(()=>{
    alive.current = true
    return ()=>{alive.current = false;request.current?.abort()}
  },[])
  const valid = (value:string) => {
    const date = new Date(`${value}T00:00:00Z`)
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(date.getTime()) && date.toISOString().slice(0,10) === value
  }
  const rangeValid = valid(from) && valid(through) && from >= start && through <= end && from <= through
  async function download() {
    if (request.current || !rangeValid) return
    const controller = new AbortController()
    request.current = controller
    setPending(true);setError('');setComplete(false)
    const timeout = setTimeout(()=>controller.abort(),60000)
    try {
      const query = new URLSearchParams({year:String(year),month:String(month),start:from,end:through,currency,basis})
      const response = await fetch(`/api/reports/accountant?${query}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal})
      if (!response.ok) throw new PacketDownloadError(response.status === 413 ? 'This packet is too large. Choose a shorter date range.'
        : response.status === 429 ? 'Another packet is being prepared. Try again shortly.'
        : response.status === 401 ? 'Sign in again to download your packet.' : 'Could not prepare the packet. Try again.')
      if (response.headers.get('Content-Type') !== 'application/zip') throw new PacketDownloadError('Could not prepare the packet. Try again.')
      const blob = await response.blob()
      if (!alive.current || controller.signal.aborted) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url;link.download = `amountly-accountant-${from}-${through}-${currency}.zip`
      document.body.appendChild(link);link.click();link.remove()
      setTimeout(()=>URL.revokeObjectURL(url),1000)
      setComplete(true)
    } catch (cause) {
      if (alive.current && !controller.signal.aborted) setError(cause instanceof PacketDownloadError ? cause.message : 'Could not prepare the packet. Try again.')
      else if (alive.current && open) setError('The download was cancelled or timed out. Try again.')
    } finally {
      clearTimeout(timeout)
      if (request.current === controller) request.current = null
      if (alive.current) setPending(false)
    }
  }
  return <Dialog open={open} onOpenChange={value=>{setOpen(value);if (!value) request.current?.abort()}}>
    <DialogTrigger asChild><Button variant="outline" disabled={disabled}>Export accountant packet</Button></DialogTrigger>
    <DialogContent>
      <DialogHeader><DialogTitle>Accountant packet</DialogTitle><DialogDescription>Download records, a receipt index, and original receipts in one ZIP. Choose a month, quarter, or the full workspace period.</DialogDescription></DialogHeader>
      <p className="text-sm">{currency} · {basis === 'cash' ? 'Cash received' : 'Invoices issued'}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="packet-from">From</Label><Input id="packet-from" type="date" min={start} max={end} value={from} disabled={pending} onChange={event=>{setFrom(event.target.value);setComplete(false);setError('')}} /></div>
        <div className="space-y-2"><Label htmlFor="packet-through">Through</Label><Input id="packet-through" type="date" min={start} max={end} value={through} disabled={pending} onChange={event=>{setThrough(event.target.value);setComplete(false);setError('')}} /></div>
      </div>
      {!rangeValid && <p className="text-sm text-destructive" role="alert">Choose a valid date range within {start} through {end}.</p>}
      <p className="text-sm text-muted-foreground">The receipt index identifies missing originals and whether each expense was reviewed. Captured expenses are not proof of payment or deductibility. Up to 100 receipts and 25 MB of originals per packet.</p>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {complete && <p className="text-sm" role="status">Your packet is ready. Missing originals, if any, are listed in the receipt index.</p>}
      <DialogFooter><Button variant="outline" onClick={()=>{request.current?.abort();setOpen(false)}}>{pending ? 'Cancel' : 'Close'}</Button><Button disabled={pending || !rangeValid} onClick={()=>void download()}>{pending ? 'Preparing packet…' : 'Download ZIP'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
