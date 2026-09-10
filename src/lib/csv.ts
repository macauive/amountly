// Preserve real numbers; treat all user-controlled strings as spreadsheet text.
export function escapeCsvValue(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (typeof value !== 'number' && /^[\s\u0000-\u001f\u007f\ufeff]*[=+@-]/u.test(text)) {
    text = `'${text}`
  }
  // Always quote text so CR, LF, quotes and delimiters cannot create extra cells.
  return `"${text.replace(/"/g, '""')}"`
}
