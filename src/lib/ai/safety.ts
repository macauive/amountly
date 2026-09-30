export type RedactionResult = {
  redacted: string
  replacements: Record<string, string>
}

const injectionPatterns = [
  /\bignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|messages|rules)\b/i,
  /\b(disregard|override)\s+(the\s+)?(system|developer|previous|prior)\s+(instructions|message|prompt|rules)\b/i,
  /\b(system|developer)\s+prompt\b/i,
  /\breveal\s+(your\s+)?(instructions|prompt|system\s+message|developer\s+message)\b/i,
  /\bjailbreak\b/i,
  /\bdo\s+anything\s+now\b/i,
  /\bact\s+as\s+(?:dan|an\s+unrestricted)\b/i,
  /\bexfiltrate\b/i,
]

const sensitivePatterns: Array<[RegExp, string]> = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 'EMAIL'],
  [/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g, 'PHONE'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, 'SSN'],
  [/\b(?:\d[ -]*?){13,19}\b/g, 'CARD'],
  [/\b\d{1,6}\s+[A-Za-z0-9 .'-]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|way|court|ct)\b/gi, 'ADDRESS'],
]

export function detectPromptInjection(value: unknown): string | null {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (!text) return null

  const match = injectionPatterns.find((pattern) => pattern.test(text))
  return match ? 'The AI request contains instruction-like text that could interfere with model behavior.' : null
}

export function redactPersonalData(value: string): RedactionResult {
  const replacements: Record<string, string> = {}
  let redacted = value
  let index = 0

  for (const [pattern, label] of sensitivePatterns) {
    redacted = redacted.replace(pattern, (match) => {
      const token = `[REDACTED_${label}_${index}]`
      replacements[token] = match
      index += 1
      return token
    })
  }

  return { redacted, replacements }
}

// Email fields select server-owned references, never model-generated addresses.
// One distinct source value is unambiguous; multiple values may be left blank.
export function contactEmailReferences(replacements: Record<string, string>): [string, ...string[]] {
  const entries = Object.entries(replacements).filter(([token]) => /^\[REDACTED_EMAIL_\d+\]$/.test(token))
  const tokens = entries.map(([token]) => token)
  if (new Set(entries.map(([, value]) => value)).size !== 1) tokens.unshift('')
  return tokens as [string, ...string[]]
}

export function restoreRedactedData<T>(value: T, replacements: Record<string, string>): T {
  if (typeof value === 'string') {
    const restored = Object.entries(replacements).reduce<string>(
      (text, [token, replacement]) => text.replaceAll(token, replacement),
      value
    )
    return restored as T
  }

  if (Array.isArray(value)) {
    return value.map((item) => restoreRedactedData(item, replacements)) as T
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, restoreRedactedData(nested, replacements)])
    ) as T
  }

  return value
}
