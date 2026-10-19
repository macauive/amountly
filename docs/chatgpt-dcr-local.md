# Amountly DCR — local candidate, October 19, 2026

Implemented in an isolated worktree based on the local `origin/main` reference at `2b8ec6eaeaa4928354b47375a66b996b14c5fecb`. No deployment, environment update, plugin upload, submission, production account change or email send is part of this candidate.

## Behavior

The existing CIMD path remains supported. Dynamic client registration is opt-in: `AMOUNTLY_CHATGPT_DCR=enabled` is required alongside the existing Render-backend and ChatGPT feature flags. Without the flag, registration returns 404 and the registration endpoint is absent from discovery. Turning the flag off also stops access through DCR client IDs; it does not delete client or grant records.

When enabled, discovery advertises `/api/auth/oauth2/register`. This route accepts a bounded RFC 7591 JSON request for a public `token_endpoint_auth_method=none` client. Better Auth generates and stores an opaque client ID with an `amt_dcr_` prefix. The prefix is only an input format check; the initialized OAuth provider must still resolve the registered client and validate its stored callbacks, grants, scopes and token state.

The route permits only canonical HTTPS ChatGPT callback URLs already allowed by Amountly. Arbitrary hosts, loopback redirects, query strings, fragments and normalized path aliases are rejected. The provider checks the exact registered callback on authorization and exchange. The separate Codex CIMD loopback policy is unchanged.

Registration cannot choose client secrets, remote JWKS, consent bypass, PKCE disablement, machine grants, arbitrary resources or write scopes. Accepted scopes remain `amountly:read`, `offline_access` and optional `email`; registering scope capabilities does not grant access to a user's data. Signed-in, verified, active users must explicitly consent. Tokens retain the existing resource/issuer binding, hashed storage, ten-minute access lifetime, seven-day grant checks and replay-family revocation.

Registration requests have a 4 KiB body cap, allowlisted fields, bounded arrays/strings, bounded in-process admission and a fixed durable bucket of ten requests per minute. This service-level registration bucket is separate from all existing user and browser sign-in quotas. Cookie-bearing requests, authorization headers and unexpected browser origins are rejected. Unauthenticated registration is not cryptographic proof that the caller is OpenAI; callbacks constrain where codes can go, and PKCE, user consent and the provider's client/token checks remain mandatory.

No database migration or dependency change is required. DCR uses the existing pinned Better Auth 1.7.7 OAuth tables and provider.

## Local verification

`npm run test:chatgpt` includes the new DCR tests. They execute the real pinned provider and application routes with in-memory auth persistence and a synthetic financial-data adapter. They cover discovery/feature-off behavior, invalid registration metadata, request limits, unknown client IDs, callback/resource/scope/PKCE failures, denied consent, code/client binding, all five MCP tool handlers, data redaction, token hashing, code/refresh replay, cross-client token/revocation attempts, account disablement and revocation. Existing CIMD/Codex tests run alongside them.

`npm run test:chatgpt:dcr:local` creates a fresh PostgreSQL cluster at loopback port 54399 and starts the actual Next.js app on 127.0.0.1:4191. It generates isolated auth tables and one synthetic verified account, performs real HTTP registration/login/consent/token exchange, discovers all five tools, rotates and revokes tokens, then stops both services and removes its generated credentials and database. It requires locally installed `initdb` and `pg_ctl`, free ports and an isolated checkout without dotenv files. It loads no deployment configuration and configures no email provider. The financial data adapter/PostgREST/RLS layer is not part of this HTTP rehearsal; tool behavior is covered by the integration tests and existing financial-review tests.

For in-app browser verification, run `npm run test:chatgpt:dcr:local -- --browser`. The protected temporary state file supplies a fresh local login transaction and synthetic credentials in-process. Successful browser login must reach the actual read-only consent page. Do not click through to the external ChatGPT callback: the HTTP test already consumes its own code locally with redirects disabled. Enter `stop` in the rehearsal terminal to stop and clean up.

## Future hosted test, separately authorized

After reviewing the local results, a hosted trial would require deploying these source changes and explicitly enabling the DCR feature flag. A later package would choose `extensions.com.openai.auth.client.mode: dcr` with `registrationUrl: https://amountly.app/api/auth/oauth2/register`. Keep credentials outside the package, retain the same scopes and existing plugin identity, and inspect the effective saved settings before connecting.

Local success proves this implementation's protocol behavior. It does not establish that the OpenAI portal will switch its saved registration path or that the original rejection is resolved. A real hosted connection, signed-in reviewer test and tool scan remain required before resubmission.
