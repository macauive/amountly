import { format, parseISO } from 'date-fns'

export function formatDateOnly(value: string | null | undefined, pattern = 'MMM d, yyyy') {
  if (!value) return '-'

  const dateOnly = dateInputValue(value)
  const [year, month, day] = dateOnly.split('-').map(Number)

  if (!year || !month || !day) {
    return format(parseISO(value), pattern)
  }

  return format(new Date(year, month - 1, day), pattern)
}

export function dateInputValue(value: string | null | undefined) {
  if (!value) return ''
  // Financial commands encode calendar dates at UTC midnight. PostgreSQL may
  // serialize the same instant with its session offset; recover the UTC day.
  if (/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    const date = parseISO(value)
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : ''
  }
  return value.slice(0, 10)
}

export function dateFormatPattern(preference: unknown) {
  return preference === 'DD/MM/YYYY' ? 'dd/MM/yyyy' : preference === 'YYYY-MM-DD' ? 'yyyy-MM-dd' : 'MM/dd/yyyy'
}

export function formatPreferredDate(value: string | null | undefined, preference: unknown, includeTime = false) {
  if (!value) return '-'
  try {
    const pattern = dateFormatPattern(preference)
    return includeTime ? format(parseISO(value), `${pattern} p`) : formatDateOnly(value, pattern)
  } catch { return '-' }
}
