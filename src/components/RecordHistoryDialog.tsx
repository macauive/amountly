'use client'
import { useEffect, useState } from 'react'
import { getRecordHistory, type RecordEvent } from '@/services/review.service'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function RecordHistoryDialog({ kind, id, onClose }: { kind: string; id: string; onClose: () => void }) {
  const [events, setEvents] = useState<RecordEvent[]>([])
  const [state, setState] = useState('Loading history…')
  useEffect(() => { let active = true; getRecordHistory(kind, id).then(rows => { if (active) { setEvents(rows); setState(rows.length ? '' : 'Earlier changes were not recorded.') } }).catch(() => { if (active) setState('Could not load history. Close and try again.') }); return () => { active = false } }, [kind, id])
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>Record history</DialogTitle><DialogDescription>Changes recorded since history tracking was introduced.</DialogDescription></DialogHeader>{state && <p role="status">{state}</p>}<ul className="space-y-3">{events.map(event => <li key={event.id} className="border-b pb-3 text-sm"><p className="font-medium">{event.action.replaceAll('_', ' ')}{event.previous_status !== event.next_status ? ` · ${event.previous_status ?? 'New'} → ${event.next_status}` : ''}</p><p>{new Date(event.created_at).toLocaleString()}</p>{!!event.changed_fields.length && <p className="text-muted-foreground">Fields: {event.changed_fields.map(field => field.replaceAll('_', ' ')).join(', ')}</p>}{Object.entries(event.next_values ?? {}).filter(([field, value]) => value != null && (event.action === 'created' || value !== event.previous_values?.[field])).map(([field, value]) => <p key={field} className="text-muted-foreground">{field.replaceAll('_', ' ')}: {event.previous_values?.[field] != null ? `${event.previous_values[field]} → ` : ''}{String(value)}</p>)}</li>)}</ul></DialogContent></Dialog>
}
