# Amountly ChatGPT release

The initial release exposes five read-only MCP tools at `https://amountly.app/mcp`:
financial review, unpaid invoices, upcoming bills, expense summaries, and an
authorized supporting record. It uses the existing authenticated financial
review service and non-owner PostgREST role. Account and organization permissions
remain enforced by both the service and database policies. Expenses are owned by
users, rather than organizations.

## Authentication and boundaries

- Better Auth 1.7.7 OAuth provider and CIMD, with only allowlisted HTTPS ChatGPT
  client documents and callbacks. Dynamic registration and client CRUD are off.
- Authorization code with S256 PKCE, resource binding, issuer identification,
  opaque hashed access and refresh tokens, and `private_key_jwt` support.
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

Enable `AMOUNTLY_CHATGPT=enabled`, `AMOUNTLY_REVIEW_MODE=account`, and the exact
`OPENAI_APPS_DOMAIN_CHALLENGE` supplied by the current OpenAI draft. Retain the
existing compute and runtime-role credentials. To stop new MCP/OAuth access,
disable `AMOUNTLY_CHATGPT` and redeploy; keep the private migration and grant
tombstones. Do not restore a whole financial database to roll back app code.

## Verification and submission

Local verification includes existing financial/security regressions, database
security checks, six boundary tests, lint, and a Node 24 Docker build. The actual
HTTP OAuth suite passes in a 512 MB / 0.5 CPU production container, covering all
five tools, foreign records, injection minimization, malformed input, issuer and
resource binding, S256, code/refresh/assertion replay, account disablement,
disconnect including late token writes, seven-day consent expiry, CSRF and
deletion-request ownership. Browser verification checks selectable review dates
and source records using the designated QA account.

Live OpenAI discovery now finds all five tools and its latest MCP scan reports
no issues. The Finance package metadata and skill checks pass. A regression test
resolves OpenAI's actual public client metadata and validates a synthetic token
through the initialized CIMD provider; the earlier fresh-options implementation
fails that test with HTTP 401. Refresh access is optional for tool calls.

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
