import { randomUUID } from 'node:crypto'
import { AiHttpError } from '@/lib/ai/server'

const authorizationReasons = ['authorize_query_too_large', 'authorize_duplicate_parameter',
  'authorize_client_missing', 'authorize_client_invalid', 'authorize_callback_missing',
  'authorize_callback_disallowed', 'authorize_response_type_invalid', 'authorize_resource_missing',
  'authorize_resource_mismatch', 'authorize_pkce_method_invalid', 'authorize_pkce_challenge_invalid',
  'authorize_state_invalid', 'authorize_scope_invalid', 'authorize_signature_invalid'] as const

// Validation failures are invalid_request, not expired connection invalid_grant errors.
export class AuthorizationRequestError extends AiHttpError {
  constructor(readonly reason: typeof authorizationReasons[number]) {
    super(400, 'Invalid connection request')
  }
}

const reasons = [...authorizationReasons, 'grant_inactive', 'session_inactive', 'account_inactive', 'token_invalid',
  'permission_missing', 'rate_limited', 'invalid_request', 'invalid_client', 'invalid_grant',
  'unauthorized_client', 'unsupported_grant_type', 'invalid_scope', 'access_denied',
  'temporarily_unavailable', 'request_rejected'] as const
export type ConnectionFailure = typeof reasons[number]
export type ConnectionRoute = 'mcp' | 'oauth:register' | 'oauth:authorize' | 'oauth:consent' | 'oauth:token' | 'oauth:revoke' | 'oauth:unknown'

export class ConnectionError extends AiHttpError {
  constructor(status: number, readonly reason: ConnectionFailure, message = 'Reconnect Amountly to continue.') {
    super(status, message)
  }
}

// Fixed reasons and per-reason budgets bound log size and volume. A flood of
// anonymous invalid tokens cannot consume the expired-grant diagnostic budget.
// Never serialize supplied errors, URLs, bodies, identities or request IDs.
export function createConnectionDiagnostics(write: (entry: string) => void = entry => console.warn(entry), now = Date.now) {
  let windowStart = now()
  const counts = new Map<ConnectionFailure, number>()
  return (response: Response, route: ConnectionRoute, error?: unknown, providerCode?: string) => {
    const requestId = randomUUID()
    response.headers.set('X-Amountly-Request-Id', requestId)
    if (response.status < 400) return response
    const reason: ConnectionFailure = error instanceof ConnectionError || error instanceof AuthorizationRequestError ? error.reason
      : response.status === 429 ? 'rate_limited'
      : response.status >= 500 ? 'temporarily_unavailable'
      : reasons.includes(providerCode as ConnectionFailure) ? providerCode as ConnectionFailure
      : 'request_rejected'
    const time = now()
    if (time - windowStart >= 60_000) { windowStart = time; counts.clear() }
    const count = counts.get(reason) ?? 0
    if (count < 10) {
      counts.set(reason, count + 1)
      try { write(JSON.stringify({ event: 'amountly_connection_failure', requestId, route, status: response.status, reason })) }
      catch { /* Diagnostic transport must never change authorization behavior. */ }
    }
    return response
  }
}

export const diagnoseConnection = createConnectionDiagnostics()
