# Financial review implementation

Local development, 2026-09-29. No deployment, production migration, or customer-data agent execution is authorized by this work. The user subsequently authorized saving the API-key permission fix and continuing synthetic tests.

## Plan and progress

1. Inspect auth, RLS, account capabilities, invoice payments/reversals, bills, current bounded Responses flows, and existing work — complete.
2. Build shared account-scoped read service, deterministic calculations, MCP tools, synthetic fixtures, interactive panel — implemented and locally verified.
3. Build bounded Agents API integration using synthetic records only — implemented and contract-tested. Live session creation rejected with HTTP 403 (`forbidden`); no successful live agent execution is claimed.
4. Add opt-in application-event reduction and replay tests — implemented with a local persistent journal and replay demonstration; production ingestion and MCP Events remain separate follow-up work.
5. Run auth/isolation, boundary, calculation, failure, replay, repository checks, and in-app browser verification — complete within the limits below.

## Architecture and boundaries

`src/lib/financial-review` contains shared schemas, scoped database reads, deterministic calculations, MCP tools, and agent coordination. Web and MCP call the same service; future iOS clients can call the bearer-authenticated HTTP API. Existing receipt extraction, invoice-reminder drafting, and dashboard Responses code are unchanged.

Every account request verifies the Supabase user and active profile, uses that user's non-privileged client and RLS, gates resource types by capabilities, adds explicit ownership filters, and rechecks returned ownership. Inputs accept dates and currency, never an owner/organization identifier or SQL. Reads select only needed columns, paginate, and fail closed at 2,000 rows per resource or 512 KB of review output. Source labels are bounded to 160 characters. No partial totals on read/validation/limit failure. Nested payment reversals follow the existing invoice calculation. Descriptions remain untrusted text. Receipt paths/URLs stay server-side; only presence affects findings.

Date semantics: invoice balances/bill states are current. Overdue means due date before the as-of day (UTC for account mode). Obligations include past due and the next seven days inclusive. Selected period (maximum 31 inclusive days) controls expenses. Expenses include non-archived, non-rejected records; this is a review, not an accounting statement. Currency is never combined. Unusual means at least three prior category observations in 90 days, amount at least three times their median and at least 100 currency units. Missing references and unusual amounts are review flags, not judgments of legitimacy.

## Local configuration

- `npm ci`
- `AMOUNTLY_REVIEW_MODE=synthetic npm run dev -- --hostname localhost --port 4180`
- Open `http://localhost:4180/review-preview`. The actual MCP HTML panel can also be exercised at `http://localhost:4180/api/financial-review/panel-preview` in a sandboxed local bridge harness. The synthetic fixture clock is 2026-09-29.
- The MCP endpoint is `http://localhost:4180/api/mcp`; local package: `plugins/amountly-review`. The package points only to this synthetic local endpoint. No API key is needed for basic plugin tools.
- For a bounded synthetic agent preview, retain `OPENAI_API_KEY` in the ignored local `.env.local` and start with `AMOUNTLY_SYNTHETIC_AGENT=enabled`. Optional `OPENAI_REVIEW_MODEL` overrides the existing `OPENAI_MODEL`; both the review-agent fallback and existing AI capture/drafting fallback are `gpt-6-luna`.
- The SDK is pinned to `openai@7.25.0`; the documented minimum for Agents API TypeScript is 7.15.0. SDK installation alone does not prove account access. Required project permissions are `api.agents.read`, `api.agents.write`, and `api.responses.write`. Live testing additionally required List models Read (`api.model.read` / `model.read`) for the service's model lookup. These narrow key settings were saved during troubleshooting; the application itself does not modify permissions.
- Synthetic mode is rejected outside development or off the loopback hostname. Default mode is disabled. `AMOUNTLY_REVIEW_MODE=account` enables the existing Supabase bearer-authenticated read service, but must not be used with customer data during initial development. The agent route refuses account mode regardless of API key.

## Agents API constraints, checked against official docs

The Agents API currently supports **US data residency only** and **does not support Zero Data Retention**, even with a self-hosted sandbox. Real customer-data execution requires an explicit product/privacy/data-handling decision outside this implementation. `store: false` on the existing Responses route does not apply to Agents API sessions.

This review needs functions only, so it uses `environment: { type: 'none' }`: no sandbox shell, file access, remote MCP, or unrestricted query tool. Session/turn IDs and actual completion are checked, tool arguments are strict, tool calls are bounded, and returned finding IDs must exist in deterministic results. The agent cannot provide UI links or financial amounts, and prioritization never drops an existing deterministic finding. A timeout/failed/cancelled/interrupted turn is not reported as completed. Session deletion is attempted at the end. This initial request-bound preview is not a durable production worker; disconnect recovery and durable resource tracking must precede customer-data enablement.

Sources:
- https://developers.openai.com/api/docs/guides/agents-api/overview
- https://developers.openai.com/api/docs/guides/agents-api/architecture
- https://developers.openai.com/api/docs/guides/agents-api/quickstart
- https://developers.openai.com/api/docs/guides/agents-api/tools/functions
- https://developers.openai.com/plugins/build/extensions
- https://developers.openai.com/plugins/build/chatgpt-ui
- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/plugins/build/mcp-events

## Plugin installation boundary

The local SDK transport and tools can be tested directly with an MCP client. ChatGPT installation requires developer-mode MCP registration and an appropriate reachable development endpoint. Private account-data use additionally requires a reviewed OAuth 2.1 resource-server integration with discovery, audience/resource validation and restricted scopes; the app's ordinary Supabase bearer token is not presented as a complete ChatGPT OAuth integration. This change neither publishes nor registers a remote plugin. The local package deliberately has no registered remote plugin ID or fabricated OAuth issuer.

MCP Apps uses `text/html;profile=mcp-app`, the UI bridge, and global/thread entrypoint metadata. Host integration remains unverified until an actual ChatGPT connection is authorized. UI uses text nodes and no external resources. The only plugin tools read data.

## Application events versus MCP Events

`prepareFollowThrough` is an application-event reducer: explicit account opt-in, tenant checks, per-record monotonic versions, event-ID deduplication, bounded history, and review-only drafts. It does not accept text instructions or callback URLs. The caller must authenticate events, reload scoped data and atomically persist the returned state/cursor. The local-only `event-journal.ts` provides a per-account exclusive lock, restrictive filesystem permissions and atomic state replacement. Replay state survives process reloads. Run `node scripts/review-event-demo.cjs --enable` to explicitly opt the synthetic account in and process/replay a sample invoice event; omitting `--enable` disables it. The command prints the local journal path, and a repeated event produces exactly one review flag. This is not a production event source or worker. A crashed process can leave a lock requiring inspection; power-loss durability, automatic recovery, multi-host coordination and database delivery are not claimed.

MCP Events is a distinct subscription/delivery protocol. Current ChatGPT docs require MCP 2.0 (`2026-07-28`), durable subscriptions, verified callback URLs, signing secrets, signed webhook delivery, replay protection and unsubscribe. The installed public TypeScript SDK 1.31.0 advertises MCP versions through `2025-11-25`, not MCP 2.0. This server therefore does not advertise events or send callbacks. Durable application-event storage/worker and MCP 2.0 delivery need separate implementation and verification; no fake subscriptions are offered.

## Verification

Verified 2026-09-29:

- `node --test tests/*.test.cjs`: **70 passed**, including 22 new financial-review tests. Coverage includes authentication, inactive users, owner/tenant boundaries, member capabilities, safe record reads, malformed/oversized input, timestamp/calendar boundaries, currency separation, payments/reversals, bounded reads, generic errors, MCP discovery/tool/resource transport, replay/opt-out/persistent journal, and synthetic Agents lifecycle/failure behavior.
- `npm run test:security:db`: all checks passed against a fresh disposable PostgreSQL cluster. Existing migrations and RLS were exercised; no production database was used or changed.
- `npm run lint` and `npm run build`: passed.
- Plugin scaffold validation passed using the skill validator. `npm install` reported zero audited dependency vulnerabilities; new public SDK versions are pinned and locked.
- In-app browser: sample period review, expected totals ($1,800 outstanding, $965 obligations, $420 period expenses), unpaid-invoice view, supporting-record display and live-agent failure fallback verified. The actual MCP HTML panel rendered through the local bridge harness; bills navigation and supporting-record retrieval through the MCP endpoint verified. No browser error logs were present in the checked view.
- Local event demo: explicit synthetic opt-in + duplicate replay persisted **one** review flag.
- Live Agents API: UI attempt failed safely; a bounded diagnostic confirmed `PermissionDeniedError`, HTTP **403**, code **forbidden** during session creation. A subsequent diagnostic established the exact provider error: `Managed Agents requests require the api.agents.write permission`. The official API endpoint and absent organization/project overrides were verified. The existing local key matched the Amountly dashboard key's masked suffix; its Agents permission was **None**. The permission fix and successful retest are recorded below.

Limits: the local Supabase CLI stack was not running, so the new read service was tested with scoped synthetic clients rather than a live Supabase Auth/PostgREST integration. Disposable PostgreSQL tests validate existing database isolation separately. ChatGPT registration, host entrypoints, OAuth account connection, production events, and MCP Events delivery remain unverified or unimplemented as described above. The local MCP bridge is not represented as a ChatGPT-host test.

At initial validation, no commit, publication, deployment, production migration, automatic email, payment, or real financial-record mutation had been performed. The user subsequently authorized committing and pushing after successful retesting. The Amountly key remains Restricted; Agents Write and List models Read were added during the authorized troubleshooting follow-up. Existing unrelated untracked files and `.gitignore` were left untouched. The API key remains only in local configuration.

### Retest after credits were added

2026-09-29 23:38 UTC: retried the same bounded synthetic review with the existing local key and the model configured before the switch to `gpt-6-luna`. Session creation still returned HTTP **403**, code **forbidden** (`PermissionDeniedError`). The provider response indicated access denial and did not indicate insufficient credits/quota. At that point live execution remained unverified and account permissions had not been changed; the successful follow-up is recorded below.

The follow-up investigation confirmed missing `api.agents.write`. The [official quickstart](https://developers.openai.com/api/docs/guides/agents-api/quickstart) requires `api.agents.read`, `api.agents.write`, and `api.responses.write`. With the user's explicit approval, Agents was changed from None to Write. The next live response was `The caller is not authorized to retrieve models`; adding List models Read resolved that metadata lookup requirement. The key remains Restricted, with its existing Responses permissions and expiration preserved. All other resource categories remain None.

The bounded direct synthetic review then completed with the previously configured model, one function tool call, all five validated findings, and `cleanup: deleted`. No application-code change was needed to resolve the API failure.

The in-app browser then completed a second synthetic run through the actual Review sample with agent button. The UI displayed “Agent review complete” and all five findings with supporting-record links. This verifies the local browser → API route → Agents API → validated result path.

### Model alignment

Both application model defaults and all explicit repository model references now use `gpt-6-luna`. Local environment files contain no model overrides. Lint, production build, and 25 focused capture/review tests passed. A live Responses API structured-output smoke test completed with `gpt-6-luna`. The actual local agent route returned HTTP 200, five findings, and one tool call. Earlier attempts encountered intermittent permission rejections even while the dashboard retained the saved scopes. The route reported cleanup pending; a follow-up identified only recent idle synthetic sessions by the exact review-agent instructions, model, and environment, then successfully deleted both matches. No alternate model fallback was introduced.

### Pre-commit live verification

The requested retest exercised all eight existing AI tasks against `gpt-6-luna`: expense capture, receipt capture, invoice lines, invoice reminders, time entry, contact capture, time invoice drafts, and dashboard insights. The actual route code and OpenAI Responses API were used with synthetic authentication/quota test doubles; no customer records or production database writes were involved. Expected amounts, durations, restored contact email, and output schemas were checked.

Live testing exposed currency suffixes in captured monetary strings. The provider-facing strict schema now constrains expense/receipt amounts to the application's numeric-only money format, retaining server-side validation. Contact instructions now explicitly preserve redacted placeholders for server restoration. All tasks achieved passing live results; expense, receipt, and contact capture each passed two consecutive post-fix tests. Two focused regression tests cover monetary validation and contact redaction/restoration.

The actual local review-agent HTTP route returned 200, five validated findings, one tool call, and successful session deletion. Final checks: 72 automated tests passed, all disposable-database security suites passed, lint and build passed, and the local plugin package validator passed. The production Auth/PostgREST path was not exercised by these synthetic model checks. No deployment or plugin publication was requested.

### Production verification follow-up

The initial production contact smoke test exposed a model response containing a generic redaction marker instead of the server's exact email reference. Contact capture now supplies only the current request's email references as schema enum choices and validates the selected reference again before restoration. A single distinct email is required; multiple distinct emails may remain blank rather than being guessed. Original email values remain outside the provider request. Phone and street-address extraction retain their existing behavior.

The disabled agent route now returns 404 instead of converting its feature gate into a 502. Cross-origin and malformed/oversized requests also retain their 403/400/413 statuses without starting OpenAI. Neither MCP nor customer-data agent execution was enabled by these fixes. Regression coverage includes altered and fabricated email references, duplicate/ambiguous source emails, and disabled/invalid agent requests.
