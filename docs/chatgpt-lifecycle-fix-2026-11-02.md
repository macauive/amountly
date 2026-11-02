# Amountly OAuth lifecycle repair — November 2, 2026

## Result

Refresh no longer issues unusable tokens for a connection whose authorization grant, browser session or account has ended. Such requests now return HTTP 400 `invalid_grant` with a reconnect message before token rotation. Fresh authorization with the existing DCR client restores access, including when the provider reuses existing consent without a forced consent prompt.

The existing seven-day grant limit, website-signout behavior, account checks, token rotation/replay protection, PKCE, tenant boundaries and rate limits are retained. This change fixes the demonstrated refresh inconsistency; it does not extend connection duration or establish the precise cause of OpenAI's rejection. An idle connection older than seven days still needs fresh authorization.

## Implementation and security

- `lifecycle.ts` checks only a current, unrevoked refresh capability bound to the supplied client. Grant ownership, original session ownership, session expiry, verified/active account and active public profile must all pass. Missing or inactive rows fail closed.
- Unknown, expired or replayed refresh tokens continue to the OAuth provider so its own validation and replay-family revocation remain authoritative. The new guard never authorizes a request or replaces provider checks. Revocation remains available for ended connections.
- MCP keeps the same access restrictions and records bounded reasons for inactive grants, sessions, accounts and rejected tokens. All failures retain generic public messages and the existing OAuth discovery challenge.
- OAuth/MCP diagnostics contain only a generated request ID, fixed route, status and fixed reason. They exclude credentials, raw errors/stacks, headers, query strings, identities and financial data. `X-Amountly-Request-Id` links a failed response to its log entry. Logs are capped at ten entries per fixed reason per minute per process; anonymous failures cannot consume the budget for other reasons. This is sampled diagnostic output, not a complete audit trail.
- No database migration, new dependency, credential rotation, policy-duration extension or financial-record change is required.

## Validation

- 85 focused OAuth/DCR, admission, diagnostic, auth/email, financial-review and security tests pass.
- Actual Next.js routes with disposable PostgreSQL pass initialization, web/native DCR, consent, PKCE, refresh and use of refreshed access tokens.
- Real SQL/HTTP regressions cover aged/revoked grants, expired/deleted login sessions, disabled accounts, no token creation on rejected refresh, fresh reconnect, reused consent without a forced prompt, owner disconnect and refresh-only families.
- Additional pre-commit checks pass for grants one minute before/after the cutoff; unverified, banned and inactive-profile accounts; grants and sessions belonging to another user; simultaneous refresh-token replay; and three refresh/disconnect races. Once disconnect completes, even a token issued by the raced refresh cannot access MCP or refresh again. These bounded race tests are not an exhaustive proof of all schedules.
- A simulated lifecycle-query database outage returns 503 before provider token issuance, with no raw database details in the response. These additional checks required no runtime changes.
- `npm run lint` and `git diff --check` pass.
- `npm run build -- --webpack` passes. Default Turbopack attempts failed first fetching Google Fonts in the network sandbox and then at the environment's subprocess/port restriction. No build configuration was changed to hide those failures.
- The previously reported unrelated stored-date boundary test is outside this focused run; this is not a claim that every repository test passes.

## Release boundary

The candidate is based on the previously verified production commit `3c860a7754597630acda3a5790b43888855fc8a3`. Only five runtime files, six test/package files and this report are included. The current checkout's earlier DCR reconciliation and unrelated receipt, branding and email work are not separate changes in this candidate. The 1.1.0 skill draft and rejected submission package remain untouched.

Before rollout, recheck that Render still runs the expected base commit. Deploy the isolated, tested candidate only after release authorization; then run the dedicated synthetic reviewer test against production, checking both ordinary access and refresh/reconnect recovery. A fresh OpenAI-side connection/scan is still required. The rejected release's disabled controls mean that testing may require an explicitly authorized revision. Do not submit or publish merely because direct tests pass.

Current scope: local implementation and validation only. No commit, deployment, portal revision, submission or publication has been performed.

Protocol references: [OAuth invalid_grant errors](https://www.rfc-editor.org/rfc/rfc6749#section-5.2) and [OpenAI connection troubleshooting](https://developers.openai.com/plugins/deploy/troubleshooting).
