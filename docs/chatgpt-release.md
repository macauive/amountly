# Amountly ChatGPT release

The initial release exposes five read-only MCP tools at `https://amountly.app/mcp`:
financial review, unpaid invoices, upcoming bills, expense summaries, and an
authorized supporting record. It uses the existing authenticated financial
review service and non-owner PostgREST role. Account and organization permissions
remain enforced by both the service and database policies. Expenses are owned by
users, rather than organizations.

## Authentication and boundaries

- Better Auth 1.7.7 OAuth provider with public Dynamic Client Registration (DCR)
  as the only client-registration method. Client-document discovery and signed
  client assertions are removed. Clients receive stored opaque IDs; old URL-based
  client IDs must reconnect. No client secret is required.
- Canonical HTTPS ChatGPT callbacks and bounded native HTTP loopback callbacks
  on exact `127.0.0.1` or `localhost` hosts. Native clients may choose their
  listener port at authorization; each issued code binds that exact callback.
- Authorization code with mandatory S256 PKCE, user consent, resource binding,
  issuer identification and opaque hashed access/refresh tokens.
- Access tokens last ten minutes. Read consent and refresh access expire after
  seven days. Reused codes/refresh tokens revoke their families.
- Every MCP request rechecks its grant, login session, verification and account
  state. Disconnect revokes the grant first, preventing a late refresh from
  restoring access.
- Strict request limits, scoped read-only schemas, shared atomic rate counters,
  private responses and generic errors. Arbitrary record descriptions, customer
  names, receipt URLs and tax identifiers are omitted from tool results.
- Audit events contain only user ID, tool, outcome and time; hourly maintenance
  removes events older than thirty days. Arguments and results are not logged.

## Deployment

Apply `scripts/render/migrate-chatgpt.ts --apply` as the separately configured
migration owner before enabling the integration. The transaction creates private
auth tables and a checksum ledger; a repeat with identical SQL is safe. The data
runtime cannot access private auth tables, and the auth runtime cannot change the
ledger. No owner credential belongs in the deployed service.

On October 3, 2026, the reviewed migration and isolated synthetic review fixture
were applied to Render over certificate-verified TLS after a protected backup.
The temporary single-host database rule was removed afterward. The fixture
contains a 400 USD remaining invoice balance, a 75 USD overdue bill, and 203.50 USD
in October 1-3 expenses. Reviewer credentials are outside Git in an owner-only
file and must be entered separately in OpenAI's review details.

Enable `AMOUNTLY_CHATGPT=enabled`, `AMOUNTLY_CHATGPT_DCR=enabled`,
`AMOUNTLY_REVIEW_MODE=account`, and the exact
`OPENAI_APPS_DOMAIN_CHALLENGE` supplied by the current OpenAI draft. Retain the
existing compute and runtime-role credentials. To stop new MCP/OAuth access,
disable `AMOUNTLY_CHATGPT` and redeploy; keep the private migration and grant
tombstones. Do not restore a whole financial database to roll back app code.

## Verification and submission

The DCR-only candidate is local until separately authorized for deployment.
Verification includes web/native registration, real provider PKCE exchange,
resource/issuer/state binding, five read-only tool handlers, ownership/redaction,
code/refresh replay, account disablement and owner-scoped disconnect. The
standalone rehearsal uses actual Next.js routes and a disposable auth database;
it does not provide the financial PostgREST/RLS backend. An optional installed
Codex CLI test verifies automatic DCR selection and the client's own token exchange.
See `docs/chatgpt-dcr-local.md` for commands and local-only boundaries.

Earlier release evidence and recordings do not establish the current OpenAI
submission connection state. A new hosted connection and tool scan must succeed
before claiming this authentication change resolves review access.

The captioned walkthrough at `/review/walkthrough.mp4` contains actual production
reviewer screens, OAuth consent, OpenAI discovery, and captured MCP responses for
all five positive and three negative cases. Those MCP cases ran in the local
production container using the dedicated reviewer account and an identical
synthetic fixture; the recording labels that environment explicitly. It contains
no simulated assistant conversations or authentication credentials.

The review ZIP is built from `chatgpt-plugin/` and contains no credentials.
Production discovery, domain verification, live tool checks, an accessible video
walkthrough, reviewer credentials, metadata checks and final review submission
must all succeed before reporting the app as submitted. Approval does not
authorize automatic publication.
