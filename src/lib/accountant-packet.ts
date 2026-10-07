import { createHash } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import { z } from 'zod/v3'
import { escapeCsvValue } from '@/lib/csv'
import { reportPeriod, type IncomeBasis } from '@/lib/reporting'
import { expenseEvidenceSchema, workspaceReportQuery, type ExpenseEvidence, type ReportRow } from '@/lib/workspace-report'

const day = z.string().regex(/^20\d{2}-\d{2}-\d{2}$|^210[01]-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return !isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10) === value
})
export const accountantPacketQuery = workspaceReportQuery.extend({start:day,end:day}).superRefine((query,ctx) => {
  const workspace = reportPeriod(query.year,query.month)
  if (query.start > query.end || query.start < workspace.start || query.end > workspace.end) {
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'Choose dates within the workspace period.'})
  }
})
export function accountantPacketPeriod(query:z.infer<typeof accountantPacketQuery>) {
  return {start:query.start,end:query.end,endExclusive:new Date(new Date(`${query.end}T00:00:00Z`).getTime()+86400000).toISOString().slice(0,10)}
}
export class PacketIntegrityError extends Error {}
export class PacketLimitError extends Error {}
export const packetLimits = {receipts:100,fileBytes:10*1024*1024,totalBytes:25*1024*1024,metadataBytes:2_000_000}
export type ReceiptReader = (path:string) => Promise<{bytes:Uint8Array;mime:string}|null>
export type AccountantReport = {
  ownerId:string; currency:string; basis:IncomeBasis; period:ReturnType<typeof reportPeriod>;
  rows:ReportRow[]; expenses:ExpenseEvidence[];
}
const pathPattern = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$/
const mimeForExtension:Record<string,string> = {jpg:'image/jpeg',png:'image/png',webp:'image/webp',pdf:'application/pdf'}
function privatePath(path:string,ownerId:string) {
  const match = pathPattern.exec(path)
  if (!match || match[1] !== ownerId) throw new PacketIntegrityError('Invalid receipt reference')
  return {path,extension:match[2]}
}
function reference(expense:ExpenseEvidence,ownerId:string,storageOrigin?:string):{status:string;path?:string;extension?:string} {
  if (expense.receipt_path) return {...privatePath(expense.receipt_path,ownerId),status:'included'}
  if (!expense.receipt_url) return {status:'none'}
  // Legacy signed URLs are identifiers only. Never fetch a record-supplied URL.
  if (!storageOrigin) return {status:'unsupported'}
  let url:URL, configured:URL
  try { url = new URL(expense.receipt_url); configured = new URL(storageOrigin) } catch { return {status:'unsupported'} }
  const prefix = '/storage/v1/object/sign/receipts/'
  if (url.origin !== configured.origin || url.username || url.password || !url.pathname.startsWith(prefix)) return {status:'unsupported'}
  let path:string
  try { path = decodeURIComponent(url.pathname.slice(prefix.length)) } catch { throw new PacketIntegrityError('Invalid receipt reference') }
  return {...privatePath(path,ownerId),status:'included'}
}
function signature(bytes:Uint8Array,extension:string) {
  const starts = (values:number[]) => values.every((value,index)=>bytes[index]===value)
  if (extension === 'jpg') return starts([255,216,255])
  if (extension === 'png') return starts([137,80,78,71,13,10,26,10])
  if (extension === 'pdf') return starts([37,80,68,70,45])
  return starts([82,73,70,70]) && [87,69,66,80].every((value,index)=>bytes[index+8]===value)
}
const csv = (rows:unknown[][]) => rows.map(row=>row.map(escapeCsvValue).join(',')).join('\r\n')

// Input comes from the authenticated report loader; validate again before any
// original is read. A failure returns no partial archive or attachment headers.
export async function buildAccountantPacket(report:AccountantReport,reader:ReceiptReader,options:{storageOrigin?:string}={}) {
  z.string().uuid().parse(report.ownerId)
  workspaceReportQuery.shape.currency.parse(report.currency)
  workspaceReportQuery.shape.basis.parse(report.basis)
  day.parse(report.period.start); day.parse(report.period.end)
  if (report.period.start > report.period.end || report.period.endExclusive !== accountantPacketPeriod({start:report.period.start,end:report.period.end} as z.infer<typeof accountantPacketQuery>).endExclusive) throw new PacketIntegrityError('Invalid period')
  const expenses = z.array(expenseEvidenceSchema).max(10000).parse(report.expenses)
  const ids = new Set<string>()
  for (const row of report.rows) {
    z.object({id:z.string().uuid(),date:day,type:z.enum(['income','expense']),name:z.string().max(10000),amount:z.number().finite().min(-1e12).max(1e12),status:z.enum(['RECEIVED','SENT','PAID','OVERDUE','DRAFT','SUBMITTED','APPROVED','REIMBURSED'])}).parse(row)
    if (ids.has(`${row.type}:${row.id}`) || row.date < report.period.start || row.date > report.period.end) throw new PacketIntegrityError('Invalid records')
    ids.add(`${row.type}:${row.id}`)
  }
  if (report.rows.length > 10000) throw new PacketLimitError()
  const references = expenses.map(expense=>{
    if (expense.user_id !== report.ownerId || expense.currency !== report.currency || !ids.has(`expense:${expense.id}`)
      || expense.expense_date < report.period.start || expense.expense_date > report.period.end) throw new PacketIntegrityError('Invalid expense scope')
    return reference(expense,report.ownerId,options.storageOrigin)
  })
  if (new Set(expenses.map(expense=>expense.id)).size !== expenses.length || report.rows.filter(row=>row.type==='expense').length !== expenses.length) throw new PacketIntegrityError('Invalid expense index')
  if (expenses.filter(expense=>expense.receipt_path || expense.receipt_url).length > packetLimits.receipts) throw new PacketLimitError()
  const records = csv([
    ['period_start','period_end','currency','income_basis','expense_basis','record_id','date','record_type','name','amount','status'],
    ...report.rows.map(row=>[report.period.start,report.period.end,report.currency,report.basis,'captured_record',row.id,row.date,row.type,row.name,row.amount,row.status]),
  ])
  if (strToU8(records).byteLength > packetLimits.metadataBytes) throw new PacketLimitError()
  const files:Record<string,Uint8Array> = {'records.csv':strToU8(records)}
  const index:unknown[][] = [['record_id','date','amount','currency','category','status','review_state','reviewed_at','receipt_status','receipt_file','sha256']]
  let total = 0, included = 0, unavailable = 0
  for (const [i,expense] of expenses.entries()) {
    const ref = references[i]
    let status = ref.status, file = '', hash = ''
    if (ref.path && ref.extension) {
      const original = await reader(ref.path)
      if (!original) status = 'missing'
      else {
        const bytes = original.bytes
        if (!ArrayBuffer.isView(bytes) || bytes.byteLength === 0 || original.mime !== mimeForExtension[ref.extension] || !signature(bytes,ref.extension)) throw new PacketIntegrityError('Invalid receipt file')
        if (bytes.byteLength > packetLimits.fileBytes || total + bytes.byteLength > packetLimits.totalBytes) throw new PacketLimitError()
        total += bytes.byteLength
        file = `receipts/${expense.id}.${ref.extension}`
        files[file] = bytes
        hash = createHash('sha256').update(bytes).digest('hex')
        included++
      }
    }
    if (status === 'missing' || status === 'unsupported') unavailable++
    index.push([expense.id,expense.expense_date,expense.amount,expense.currency,expense.category,expense.status,
      expense.reviewed_at ? 'Reviewed' : 'Needs review',expense.reviewed_at,status,file,hash])
  }
  files['receipt-index.csv'] = strToU8(csv(index))
  files['README.txt'] = strToU8(`Amountly accountant packet\nPeriod: ${report.period.start} through ${report.period.end}\nCurrency: ${report.currency}\nIncome basis: ${report.basis === 'cash' ? 'Cash received' : 'Invoices issued'}\n\nrecords.csv contains the selected income and captured expense records. Match expenses to receipt-index.csv by record_id. Original files are unchanged and named by expense record ID; sha256 verifies their bytes.\n\nOriginals included: ${included}\nMissing or unsupported originals: ${unavailable}\nReceipt status: included = original in this ZIP; none = no attachment recorded; missing = original unavailable; unsupported = legacy reference cannot be read safely.\n\nReviewed means the owner explicitly reviewed the expense. Subsequent expense edits clear that marker. Review is separate from business approval. Rejected and archived expenses, draft/cancelled invoices, and reversed payments are excluded. Expenses are captured records, not proof of payment or deductibility. Currencies are not combined.\n`)
  if (Object.entries(files).filter(([name])=>!name.startsWith('receipts/')).reduce((sum,[,bytes])=>sum+bytes.byteLength,0) > packetLimits.metadataBytes) throw new PacketLimitError()
  const bytes = zipSync(files,{level:0,mtime:new Date(1980,0,1)})
  if (bytes.byteLength > packetLimits.totalBytes + packetLimits.metadataBytes + 65536) throw new PacketLimitError()
  return {bytes,filename:`amountly-accountant-${report.period.start}-${report.period.end}-${report.currency}.zip`}
}
