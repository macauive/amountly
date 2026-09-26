import { format, parseISO } from 'date-fns'

export function formatDateOnly(value: string | null | undefined, pattern = 'MMM d, yyyy') {
  if (!value) return '-'

  const dateOnly = value.slice(0, 10)
  const [year, month, day] = dateOnly.split('-').map(Number)

  if (!year || !month || !day) {
    return format(parseISO(value), pattern)
  }

  return format(new Date(year, month - 1, day), pattern)
}

export function dateInputValue(value: string | null | undefined) {
  return value ? value.slice(0, 10) : ''
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
