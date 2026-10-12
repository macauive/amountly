import { dateInputValue } from '@/lib/date-format'
import { z } from 'zod/v3'
import { ExpenseStatus,InvoiceStatus,BillStatus,expenseStatusLabels,invoiceStatusLabels,billStatusLabels } from '@/types/enums'

export const recordStatuses=[...new Set([...Object.values(ExpenseStatus),...Object.values(InvoiceStatus),...Object.values(BillStatus)])]
export const recordKinds = ['expenses','invoices','bills','vendor_bills'] as const
export const recordFiltersSchema = z.object({
  q: z.string().max(100).default(''), start: z.union([z.literal(''),z.string().date()]).default(''),
  end: z.union([z.literal(''),z.string().date()]).default(''),
  kind: z.enum(['all',...recordKinds]).default('all'),
  status: z.union([z.literal('all'),z.nativeEnum(ExpenseStatus),z.nativeEnum(InvoiceStatus),z.nativeEnum(BillStatus)]).default('all'),
  receipt: z.enum(['all','attached','missing']).default('all'),
}).strict().refine(f => !f.start || !f.end || f.start <= f.end, 'Invalid date range')
export type RecordFilters = z.infer<typeof recordFiltersSchema>
export type SearchRecord = { id: string; kind: typeof recordKinds[number]; label: string; detail: string; amount: number; currency: string; date: string; status: string; receipt: boolean }
export const emptyRecordFilters: RecordFilters = { q:'',start:'',end:'',kind:'all',status:'all',receipt:'all' }
const filterKeys = Object.keys(emptyRecordFilters)
export function parseRecordFilters(params: URLSearchParams) {
  if (filterKeys.some(k => params.getAll(k).length > 1)) return null
  const input = Object.fromEntries(filterKeys.filter(k => params.has(k)).map(k => [k,params.get(k)]))
  const result = recordFiltersSchema.safeParse(input)
  return result.success ? result.data : null
}
export function recordFilterParams(filters: RecordFilters) {
  const values = recordFiltersSchema.parse(filters), params = new URLSearchParams()
  for (const key of filterKeys as (keyof RecordFilters)[]) if (values[key] !== emptyRecordFilters[key]) params.set(key,values[key])
  return params
}
export function recordsHref(filters: RecordFilters) {
  const params = recordFilterParams(filters).toString()
  return `/records${params ? `?${params}` : ''}`
}
export function safeReturnHref(input: string | null | undefined, fallback = '/records'): string {
  if (!input || input.length > 1500 || /[\\#\u0000-\u001f]/.test(input)) return fallback
  const [path, query] = input.split('?')
  if (!['/records','/expenses','/invoices','/bills','/review','/financial-review'].includes(path) || input.split('?').length > 2) return fallback
  const params = new URLSearchParams(query)
  // Only our finite list/filter links can be return destinations. No redirect,
  // scheme-relative URL, nested destination or executable protocol is accepted.
  if ([...params.keys()].some(k => ![...filterKeys,'category','review','view','currency','selected'].includes(k) || params.getAll(k).length > 1)) return fallback
  if(params.has('selected')&&!z.string().uuid().safeParse(params.get('selected')).success)return fallback
  if (path === '/records' && !parseRecordFilters(params)) return fallback
  return path + (params.toString() ? `?${params}` : '')
}
export function sourceRecordHref(record: Pick<SearchRecord,'kind'|'id'>, returnTo: string) {
  if (!z.string().uuid().safeParse(record.id).success) return '/records'
  const params = new URLSearchParams({ kind:record.kind,id:record.id,returnTo:safeReturnHref(returnTo) })
  return `/financial-review/record?${params}`
}
export function filterRecords(records: readonly SearchRecord[], filters: RecordFilters | null) {
  if (!filters) return []
  const terms = filters.q.normalize('NFKC').trim().toLocaleLowerCase('en-US').split(/\s+/).filter(Boolean)
  return records.filter(record => {
    const text = `${record.label} ${record.detail} ${record.amount.toFixed(2)} ${recordStatusLabel(record.status)} ${record.kind.replace('_',' ')} ${record.date.slice(0,10)}`.normalize('NFKC').toLocaleLowerCase('en-US')
    return terms.every(term => text.includes(term)) && (filters.kind === 'all' || filters.kind === record.kind)
      && (!filters.start || record.date.slice(0,10) >= filters.start) && (!filters.end || record.date.slice(0,10) <= filters.end)
      && (filters.status === 'all' || record.status === filters.status)
      && (filters.receipt === 'all' || (record.kind === 'expenses' && record.receipt === (filters.receipt === 'attached')))
  }).sort((a,b) => {
    const q=filters.q.normalize('NFKC').trim().toLocaleLowerCase('en-US')
    const exact=(row:SearchRecord)=>q && row.label.normalize('NFKC').toLocaleLowerCase('en-US')===q ? 1 : 0
    return exact(b)-exact(a) || b.date.localeCompare(a.date) || a.id.localeCompare(b.id)
  })
}

export const searchRecordSchema = z.object({
  id:z.string().uuid(),kind:z.enum(recordKinds),label:z.string().max(1000),detail:z.string().max(4000),
  amount:z.number().finite(),currency:z.string().min(1).max(8),date:z.union([z.string().date(),z.string().datetime({offset:true})]),
  status:z.string().min(1).max(40),receipt:z.boolean(),
}).strict().transform(row=>({...row,date:dateInputValue(row.date)})).refine(row=>z.string().date().safeParse(row.date).success,'Invalid record date')

const commonStatusLabels={...expenseStatusLabels,...invoiceStatusLabels}
export function recordStatusLabel(status:string) {
  if(Object.hasOwn(billStatusLabels,status))return 'Bill: '+billStatusLabels[status as BillStatus]
  return Object.hasOwn(commonStatusLabels,status)?commonStatusLabels[status as keyof typeof commonStatusLabels]:status
}
