'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { usesRenderBackend } from '@/lib/platform/config'
import { captureDraftHref, type CaptureDraft } from '@/lib/capture-drafts'
import { discardCapture, getCaptureDrafts } from '@/services/capture-drafts.service'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
export function CaptureDraftInbox({ onResume, refreshKey=0 }: { onResume?: (draft:CaptureDraft)=>void; refreshKey?:number }) {
  const {user}=useAuth()
  return <OwnerCaptures key={`${user?.id}:${user?.organization_id}`} onResume={onResume} refreshKey={refreshKey}/>
}
function OwnerCaptures({onResume,refreshKey}:{onResume?: (draft:CaptureDraft)=>void;refreshKey:number}) {
  const [drafts,setDrafts]=useState<CaptureDraft[]>([]), [error,setError]=useState(''), [remove,setRemove]=useState<CaptureDraft|null>(null)
  const [busy,setBusy]=useState(false), [version,setVersion]=useState(0)
  useEffect(()=>{
    if(!usesRenderBackend)return
    let active=true;setError('')
    void getCaptureDrafts().then(rows=>{if(active)setDrafts(rows)}).catch(()=>{if(active)setError('Kept captures are unavailable. Try again before starting another capture.')})
    return ()=>{active=false}
  },[refreshKey,version])
  if(!usesRenderBackend)return null
  return <Card><CardHeader><CardTitle className="text-base">Continue a capture ({drafts.length})</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-sm text-muted-foreground">Private unfinished captures. These are not expenses and are excluded from financial totals. Keep up to 10, one receipt per capture.</p>
    {error&&<p role="alert">{error}<Button variant="ghost" onClick={()=>setVersion(v=>v+1)}>Try again</Button></p>}
    <ul className="space-y-2">{drafts.map(draft=><li key={draft.id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"><div className="min-w-0"><p className="break-words font-medium">{draft.payload.fields.merchant||draft.file_name||'Unfinished expense'}</p><p className="text-sm text-muted-foreground">{draft.payload.fields.amount||'Amount needed'} {draft.payload.fields.currency} · {draft.payload.extracted?'Ready to check':'Continue capture'}</p></div><div className="flex gap-2">{onResume?<Button variant="outline" onClick={()=>onResume(draft)}>Resume capture</Button>:<Button variant="outline" asChild><Link href={captureDraftHref(draft.id)}>Resume capture</Link></Button>}<Button variant="ghost" onClick={()=>setRemove(draft)}>Discard</Button></div></li>)}</ul>
    {!drafts.length&&!error&&<p className="text-sm text-muted-foreground">Nothing kept for later yet.</p>}
    <Dialog open={!!remove} onOpenChange={open=>{if(!open&&!busy)setRemove(null)}}><DialogContent><DialogHeader><DialogTitle>Discard this unfinished capture?</DialogTitle><DialogDescription>This removes its private draft and any kept original. It does not change saved expenses.</DialogDescription></DialogHeader><div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={()=>setRemove(null)}>Cancel</Button><Button disabled={busy} onClick={async()=>{if(!remove||busy)return;setBusy(true);try{await discardCapture(remove.id,remove.revision);setRemove(null);setVersion(v=>v+1)}catch(e){setError(e instanceof Error?e.message:'Could not discard capture.')}finally{setBusy(false)}}}>Discard capture</Button></div></DialogContent></Dialog>
  </CardContent></Card>
}
