'use client'

import { useEffect, useRef, useState } from 'react'
import type { Expense } from '@/types/models'
import { getReceiptUrl } from '@/services/expenses.service'
import { Button } from '@/components/ui/button'

type Source = { file: File } | { expense: Expense }

// Render pages to canvas, not an embedded PDF/HTML document. PDF JavaScript,
// annotations, links and form actions cannot run in this viewer.
export function ReceiptDocument({ source }: { source: Source }) {
  const [file, setFile] = useState<Blob | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [page, setPage] = useState(1), [pages, setPages] = useState(1), [zoom, setZoom] = useState(1)
  const [error, setError] = useState(''), [busy, setBusy] = useState(true)
  const canvas = useRef<HTMLCanvasElement>(null)
  const fileSource = 'file' in source ? source.file : null
  const expenseSource = 'expense' in source ? source.expense : null
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | null = null
    setFile(null); setUrl(null); setPage(1); setPages(1); setZoom(1); setError(''); setBusy(true)
    void (async () => {
      try {
        let blob: Blob
        if (fileSource) blob = fileSource
        else {
          const link = await getReceiptUrl(expenseSource!)
          if (controller.signal.aborted) return
          const response = await fetch(link, { cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: controller.signal })
          const mime = response.headers.get('content-type')?.split(';')[0] ?? ''
          if (!response.ok || !['image/jpeg','image/png','image/webp','application/pdf'].includes(mime) || !response.body) throw new Error()
          const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = []
          let size = 0
          try {
            while (true) {
              const { value, done } = await reader.read()
              if (done) break
              size += value.length
              if (size > 10 * 1024 * 1024) { await reader.cancel(); throw new Error() }
              chunks.push(new Uint8Array(value))
            }
          } finally { reader.releaseLock() }
          blob = new Blob(chunks, { type: mime })
        }
        if (controller.signal.aborted) return
        if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error()
        objectUrl = URL.createObjectURL(blob)
        setFile(blob); setUrl(objectUrl); setBusy(false)
      } catch { if (!controller.signal.aborted) { setError('Could not display the original. Check your access and reopen this record.'); setBusy(false) } }
    })()
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [fileSource, expenseSource?.id, expenseSource?.receipt_path, expenseSource?.receipt_url])

  useEffect(() => {
    if (!file || file.type !== 'application/pdf') return
    let cancelled = false
    let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined
    let render: import('pdfjs-dist').RenderTask | undefined
    setBusy(true); setError('')
    void (async () => {
      try {
        const pdf = await import('pdfjs-dist')
        if (cancelled) return
        pdf.GlobalWorkerOptions.workerSrc = '/api/receipt-viewer-worker'
        task = pdf.getDocument({ data: new Uint8Array(await file.arrayBuffer()), maxImageSize: 25_000_000, stopAtErrors: true })
        const document = await task.promise
        if (document.numPages > 5) throw new Error()
        if (cancelled) return
        setPages(document.numPages)
        const sheet = await document.getPage(page)
        const base = sheet.getViewport({ scale: 1 })
        const scale = Math.min(zoom * 1.4, Math.sqrt(4_000_000 / (base.width * base.height)))
        const viewport = sheet.getViewport({ scale })
        const element = canvas.current
        if (cancelled || !element) return
        element.width = Math.ceil(viewport.width); element.height = Math.ceil(viewport.height)
        const context = element.getContext('2d')
        if (!context) throw new Error()
        render = sheet.render({ canvas: element, canvasContext: context, viewport, annotationMode: pdf.AnnotationMode.DISABLE })
        await render.promise
        if (!cancelled) setBusy(false)
      } catch { if (!cancelled) { setError('This PDF cannot be displayed. Download the original to inspect it.'); setBusy(false) } }
    })()
    return () => { cancelled = true; render?.cancel(); void task?.destroy().catch(() => {}) }
  }, [file, page, zoom])

  return <section className="min-w-0 space-y-3 rounded-xl border bg-muted/20 p-3" aria-label="Original receipt">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">Original receipt</h3>{url && <a href={url} download={file?.type === 'application/pdf' ? 'receipt.pdf' : 'receipt'} className="text-sm underline">Download original</a>}</div>
    {file && <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={zoom <= 0.75} onClick={() => setZoom(z => Math.max(0.75, z - 0.25))} aria-label="Zoom out">−</Button>
      <span className="text-sm">{Math.round(zoom * 100)}%</span>
      <Button type="button" size="sm" variant="outline" disabled={zoom >= 2} onClick={() => setZoom(z => Math.min(2, z + 0.25))} aria-label="Zoom in">+</Button>
      {file.type === 'application/pdf' && <><Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous page</Button><span className="text-sm">Page {page} of {pages}</span><Button type="button" size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next page</Button></>}
    </div>}
    {busy && <p role="status" className="text-sm">Loading original…</p>}{error && <p role="alert" className="text-sm">{error}</p>}
    <div className="max-h-[65dvh] overflow-auto rounded bg-white">
      {file?.type === 'application/pdf' ? <canvas ref={canvas} aria-label={`Receipt page ${page}`} className="h-auto max-w-full" /> : url && <img src={url} alt="Original purchase receipt" className="h-auto max-w-none" style={{ width: `${zoom * 100}%` }} onLoad={() => setBusy(false)} onError={() => setError('This image cannot be displayed. Download the original to inspect it.')} />}
    </div>
  </section>
}
