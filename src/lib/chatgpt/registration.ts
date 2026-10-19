import { z } from 'zod/v3'
import { allowedDcrCallback, allowedDcrNativeCallback } from '@/lib/chatgpt/redirect'
import { mcpResource, oauthScopes } from '@/lib/chatgpt/config'

// Client metadata is self-asserted. It cannot grant access, choose an arbitrary
// redirect, disable consent/PKCE, or configure remote keys or fetch destinations.
const registrationSchema = z.object({
  client_name: z.string().trim().min(1).max(128).optional(),
  redirect_uris: z.array(z.string().max(512).refine(allowedDcrCallback)).min(1).max(5),
  token_endpoint_auth_method: z.literal('none'),
  grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).min(1).max(2)
    .refine(values => values.includes('authorization_code') && new Set(values).size === values.length).optional(),
  response_types: z.array(z.literal('code')).length(1).optional(),
  application_type: z.enum(['web', 'native']).optional(),
  scope: z.string().min(1).max(128).refine(value => {
    const scopes = value.split(' ')
    return scopes.includes('amountly:read') && new Set(scopes).size === scopes.length
      && scopes.every(scope => (oauthScopes as readonly string[]).includes(scope))
  }).optional(),
  resources: z.array(z.string().refine(value => value === mcpResource())).length(1).optional(),
}).strict().superRefine((input, ctx) => {
  const native = input.redirect_uris.every(allowedDcrNativeCallback)
  const web = input.redirect_uris.every(uri => !allowedDcrNativeCallback(uri))
  if ((!native && !web) || (input.application_type && input.application_type !== (native ? 'native' : 'web')))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent callback application type' })
})

export function validateRegistration(value: unknown) {
  const input = registrationSchema.parse(value)
  return { ...input, client_name: input.client_name ?? 'MCP client',
    application_type: input.redirect_uris.every(allowedDcrNativeCallback) ? 'native' as const : 'web' as const,
    grant_types: input.grant_types ?? ['authorization_code', 'refresh_token'], response_types: ['code'],
    resources: [mcpResource()] }
}
