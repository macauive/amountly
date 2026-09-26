'use client'

import { useRef, useState } from 'react'
import { RecordSaveError } from '@/services/review.service'

// Keep financial input only in this mounted form, never browser storage.
// A lost response keeps the original input/ID; an explicit rejection unlocks it.
export function useCreateAttempt<T>() {
  const attempt = useRef<{ id: string; input: T; uncertain?: boolean } | null>(null)
  const busy = useRef(false)
  const [message, setMessage] = useState<string | null>(null)
  const [unknown, setUnknown] = useState(false)

  async function run<R>(input: T, save: (input: T, id: string) => Promise<R>): Promise<R> {
    if (busy.current) throw new Error('A save is already in progress.')
    busy.current = true
    attempt.current ??= { id: crypto.randomUUID(), input: JSON.parse(JSON.stringify(input)) as T }
    const current = attempt.current
    try {
      const result = await save(current.input, current.id)
      attempt.current = null
      setUnknown(false)
      setMessage(null)
      return result
    } catch (error) {
      // A denial on a later retry cannot prove that an earlier request failed.
      const rejected = error instanceof RecordSaveError && error.outcome === 'rejected' && !current.uncertain
      if (rejected) attempt.current = null
      else current.uncertain = true
      setUnknown(!rejected)
      setMessage(rejected ? error.message : 'Save not confirmed. Retry the original save to find or create this record safely. Keep this page open until it is resolved.')
      throw error
    } finally { busy.current = false }
  }

  function reset() {
    if (busy.current || attempt.current) return false
    setMessage(null)
    setUnknown(false)
    return true
  }

  return { run, reset, unknown, message, input: attempt.current?.input }
}
