# Amountly DCR-only candidate — October 19, 2026

This local candidate replaces the earlier reversible client-discovery experiment. It is based on deployed DCR commit `1aeecabc4dfba010650dd553fb3958e7a0d522dc` in the isolated worktree. It has not been committed, pushed, deployed, uploaded or submitted.

## Authentication

DCR is the sole client-registration method. The client-document discovery plugin, resolver, dependency, configuration switch and signed-client-assertion request fields have been removed. Legacy URL client IDs are rejected for authorization, token exchange/refresh, revocation and MCP access. Existing users with those connections must reconnect through DCR after a future deployment.

The integration still requires `NEXT_PUBLIC_BACKEND=render`, `AMOUNTLY_CHATGPT=enabled` and `AMOUNTLY_CHATGPT_DCR=enabled`. Disabling DCR returns 404 for registration and removes its discovery endpoint. There is no alternate registration fallback.

Discovery advertises `/api/auth/oauth2/register`, S256 and public-client `none` authentication. Registration stores an opaque `amt_dcr_` client ID with the pinned Better Auth 1.7.7 provider. The ID format is only an input gate: the provider must still resolve the stored client and validate its callbacks, PKCE, consent, scopes, resource and token state.

Web callbacks are canonical HTTPS ChatGPT callbacks. Native callbacks use only canonical HTTP `127.0.0.1` or `localhost` and bounded `/callback` paths. Registrations cannot mix web/native callbacks or contradict their application type. Native clients may choose the listener port during authorization under RFC 8252; issued codes bind the actual callback port, host and path. Arbitrary hosts, aliases, credentials, query/fragment components and invalid ports are rejected.

Registration remains capped at 4 KiB, five redirects and ten requests/minute in a fixed service bucket, separate from account quotas. Cookie/auth-bearing requests and unexpected browser origins are rejected. Metadata cannot grant write scopes, arbitrary resources, machine grants, remote keys, credentials, or consent/PKCE bypass. Native client names are self-asserted, so consent uses a generic native-client label.

Access remains read-only and tenant-scoped. Hashed tokens, ten-minute access, seven-day grants, active verified account/session checks, code/refresh replay revocation and mandatory consent are unchanged. Disconnect revokes the authenticated user's grants first, then all their OAuth access/refresh capabilities and consent, including refresh-only clients. Other accounts are unaffected.

## Schema and deployment boundaries

No database migration is required for this removal. Historical applied migration SQL/checksums and generic provider tables remain intact; do not drop old tables or rewrite the migration ledger. The migration planner now uses the OAuth provider alone. Old inactive client rows are not deleted merely to change the authentication policy.

The current submission package may keep its URL-only MCP declaration and discover DCR. A future explicit declaration may choose `extensions.com.openai.auth.client.mode: dcr` and the real registration endpoint. Keep credentials out of packages. Hosted connection testing and submission remain separate, authorized steps; local success does not establish that OpenAI's saved-registration error is fixed.

## Repeatable local verification

- `npm run test:chatgpt`: actual provider tests for public web/native DCR, old-client rejection, discovery, callbacks, PKCE, state/issuer/resource/scopes, all five tools, replay, revocation, disablement, quotas and disconnect ownership.
- `npm run test:chatgpt:dcr:local`: actual Next.js and a fresh disposable PostgreSQL cluster. It refuses production dotenv files, generates one synthetic verified account, sends no email, tests discovery/registration/login/consent/PKCE/five-tool discovery/refresh/revocation and disconnect including a refresh-only family, then cleans up.
- Add `-- --codex` for an actual installed Codex CLI login with automatic DCR selection. URLs and credentials stay in-process; only a unique local test credential is stored temporarily in Keychain and removed by logout. No saved production MCP configuration or AI inference is involved.
- Add `-- --browser` for in-app consent-page verification using a protected temporary state file; add `--browser-native` for the native page. Use a terminal/PTY and enter `stop` to clean up.
- Run lint, the focused authentication/financial-review/admission tests and a production build before delivery. The HTTP auth rehearsal does not provide the financial PostgREST/RLS backend; synthetic integration tests cover tool behavior and ownership/redaction.
