import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
export const runtime = 'nodejs'
export async function GET() {
  const bytes = await readFile(join(process.cwd(), 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'))
  return new Response(bytes, { headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } })
}
