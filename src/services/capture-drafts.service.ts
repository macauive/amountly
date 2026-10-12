import { z } from 'zod/v3'
import { captureDraftSchema, captureWriteSchema, type CaptureDraft, type CapturePayload } from '@/lib/capture-drafts'

async function checked(response: Response) {
  if (!response.ok) throw new Error(response.status === 409
    ? 'This capture changed in another tab. Close and reopen it before saving.'
    : response.status === 413 ? 'Capture storage is full. Finish or discard an existing capture first.'
    : 'Could not confirm the capture. Your current form is still available; try again.')
  return response.json()
}
export async function getCaptureDrafts(): Promise<CaptureDraft[]> {
  return z.array(captureDraftSchema).max(10).parse(await checked(await fetch('/api/capture-drafts', { cache: 'no-store' })))
}
export async function keepCapture(input: { id: string; revision: number; payload: CapturePayload }, file: File | null) {
  const body = new FormData()
  body.set('metadata', JSON.stringify(captureWriteSchema.parse(input)))
  if (file) body.set('file', file)
  return captureDraftSchema.parse(await checked(await fetch('/api/capture-drafts', { method: 'PUT', body })))
}
export async function getCaptureFile(draft: CaptureDraft) {
  if (!draft.file_name || !draft.content_type) return null
  const response = await fetch(`/api/capture-drafts?id=${encodeURIComponent(draft.id)}&file=1&revision=${draft.revision}`,  { cache: 'no-store', redirect: 'error' })
  if (!response.ok) throw new Error('Could not restore this receipt. Reopen the capture and try again.')
  // The authenticated server returns at most one validated 10 MB original.
  const blob = await response.blob()
  if (!blob.size || blob.size > 10 * 1024 * 1024 || blob.type !== draft.content_type) throw new Error('This receipt is unavailable.')
  return new File([blob], draft.file_name, { type: draft.content_type })
}
export async function discardCapture(id: string, revision: number) {
  const response = await fetch('/api/capture-drafts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, revision }) })
  if (!response.ok) await checked(response)
}
