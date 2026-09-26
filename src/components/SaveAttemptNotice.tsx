export function SaveAttemptNotice({ message }: { message: string | null }) {
  return message ? <p role="status" className="my-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{message}</p> : null
}
