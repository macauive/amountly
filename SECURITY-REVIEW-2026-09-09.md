# Amountly security and bug review

Reviewed September 9, 2026. This is a scoped code review and live browser inspection, not a complete penetration test or certification.

Follow-up: security fixes and dependency updates were subsequently implemented locally. See [fixes and release requirements](./SECURITY-FIXES-2026-09-09.md). The findings below preserve the original audit baseline.

## Scope and verification

- Inspected the Next.js application, AI route, authentication flow, financial services, export code, and Supabase migrations through 019.
- Inspected the live homepage, login, signup, and signed-out dashboard navigation in the in-app browser.
- Two sign-in attempts using the locally authorized QA account failed. Browser network events reported `net::ERR_NAME_NOT_RESOLVED` for preflight/fetch; the UI reported `Failed to fetch`. This establishes a failure in this browser environment, not a proven global outage. Authenticated workflows and deployed database policies could not be verified.
- Signed-out navigation to `/dashboard` redirected to `/login`. This confirms the UI guard, not database authorization.
- `npm run lint` passed (this script runs TypeScript, not a separate security or style linter). `npm run build` passed on Next.js 16.1.6.
- Synthetic in-memory checks loaded the actual TypeScript with mocked dependencies: unauthenticated AI invocation, parsing a documented Responses API envelope, invoice update serialization, invoice numbering, and CSV escaping. No provider requests or database writes were made by those checks.
- `npm audit --omit=dev` could not complete: the sandbox could not resolve npm, and automatic approval review rejected escalation because it would disclose the dependency inventory to the registry. Known dependency vulnerabilities remain unchecked.
- No application fixes, commits, deployments, financial-data changes, or account creation were performed. This report is the only added file.

## Priority findings

### 1. High: AI route does not authenticate callers or limit usage

Evidence: [AI handler](./src/app/api/ai/route.ts#L334), [provider request](./src/app/api/ai/route.ts#L272).

`POST /api/ai` parses caller input and invokes OpenAI using the server API key without validating a Supabase session, checking account access, or applying per-user quotas/rate limits. The payload-length limit does not cap aggregate consumption. There is no explicit provider timeout or output-token cap either. Authentication in the dashboard layout does not protect this separate route.

Reproduction: an in-memory request with no cookies or authorization headers and a synthetic `invoice_line` payload invoked the mocked provider once. This is confirmed in local code; live endpoint behavior and infrastructure-level protections were not verified.

Impact: if deployed as written with a working key, anonymous callers can consume paid AI capacity and resources. The parsing bug in finding 4 does not prevent the upstream request from occurring.

Fix: verify identity on the server before body processing/provider invocation; apply durable per-user quotas, burst limits, bounded request bodies, timeouts, and output limits. Return generic errors and stable diagnostic identifiers. Avoid sending raw provider errors or validation internals to users/logs.

### 2. High: database invoice permissions exceed advertised member/contractor permissions

Evidence: [invoice policies](./supabase/migrations/010_update_rls_for_personal_accounts.sql#L133), [role capabilities](./src/lib/capabilities.ts#L89). Migration 019 does not replace these invoice policies.

Invoice read/create/update/delete policies authorize organization membership without checking role. The frontend denies invoice management to members and denies editing/deleting to contractors. Those UI restrictions can be bypassed through direct authenticated database API calls under the checked-in policies. Similar membership-only policies apply to clients and projects.

Impact: a lower-privilege member can access or alter organization invoices beyond the product's stated permissions. This is an authorization mismatch in the migration set, not a demonstrated live cross-tenant exploit. Team management is currently deferred, which reduces immediate exposure but does not make UI permissions a server boundary.

Fix: define the intended role matrix once and enforce it in RLS or narrowly granted server/database functions. Test member, contractor, admin, owner, unauthenticated, and unrelated-tenant access before enabling team workflows. Verify which policies are actually deployed.

### 3. Medium: CSV exports allow spreadsheet formula injection

Evidence: [settings export](./src/app/(dashboard)/settings/page.tsx#L29), [tax export](./src/app/(dashboard)/tax/page.tsx#L196).

Exporters escape CSV punctuation but leave formula prefixes intact in text fields such as names and notes. A synthetic `=1+1` value was exported unchanged. Spreadsheet software can interpret that cell as a formula; more harmful formulas could manipulate a reviewer's workbook or induce external requests depending on the spreadsheet and its security settings.

Fix: use a shared export serializer that neutralizes formula-leading text, including relevant control/whitespace prefixes, while preserving real numeric values. Test both export paths. CSV quoting alone is insufficient.

### 4. High functional impact: AI response parsing uses an SDK-only helper on raw HTTP JSON

Evidence: [response parsing](./src/app/api/ai/route.ts#L324).

The route uses raw `fetch` but reads `body.output_text`. Responses API text arrives inside the `output` array; the top-level aggregated `output_text` is an SDK convenience. [OpenAI documents the distinction](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).

Reproduction: a mock successful response with `output[].content[]` containing `type: output_text` yielded HTTP 500 with `OpenAI response did not include structured output text`.

Impact: shared AI capture and insights features can fail after a successful paid generation.

Fix: safely gather text from the documented output items, or use the supported SDK helper. Handle refusals, incomplete responses, empty output, and schema errors explicitly. Test with representative API envelopes.

### 5. High functional impact: editing invoices discards financial edits and resets status

Evidence: [edit initialization](./src/app/(dashboard)/invoices/page.tsx#L176), [save handler](./src/app/(dashboard)/invoices/page.tsx#L305), [update serializer](./src/services/invoices.service.ts#L104).

- The list query does not load line items, but the edit button passes the list record directly to the edit dialog. Existing lines therefore initialize as an empty default row.
- The save branch for an existing invoice never persists `lineItemsData`.
- The update serializer drops recalculated subtotal, tax amount, and total, even when the form sends them.
- Shared save data sets status to draft, so editing a sent/paid invoice resets its status while potentially retaining `paid_at`.

Reproduction: the actual update serializer received changed subtotal/tax/total and retained only `tax_rate` and `status` from those supplied fields. The other issues are directly traced through the form and service code.

Fix: fetch the complete invoice before editing and save header, lines, and derived totals in one authorized database transaction. Preserve status unless an explicit validated transition is requested. Test editing and reopening both draft and paid invoices.

### 6. High functional impact: generated invoice numbers collide across customers

Evidence: [number generator](./src/services/invoices.service.ts#L238), [global unique constraint](./supabase/migrations/001_create_core_tables.sql#L179).

The browser generates a number from the count of invoices visible under RLS, but the database requires `invoice_number` to be globally unique. Two new accounts both generate `INV-2026-0001`; the second insert conflicts. Concurrent creation and deletion also make count-based numbering unreliable. The existing database sequence is bypassed because the UI normally supplies a number.

Reproduction: two calls with independent empty-tenant count results returned the identical number.

Fix: allocate numbers atomically in the database. Choose either truly global numbering or tenant-scoped numbering with matching uniqueness constraints. Avoid count-based allocation.

### 7. Medium: receipt references expire after seven days

Evidence: [receipt upload](./src/services/expenses.service.ts#L124), [expense persistence](./src/app/(dashboard)/expenses/page.tsx#L175).

Uploads return a signed URL valid for seven days. The expense saves that URL as its durable `receipt_url`. No renewal or durable object-path read flow exists in the inspected source. Thus the saved reference expires even though the private storage object still exists. Exporting the URL also copies a temporary access credential.

Fix: store the storage object path, then authorize access and mint a short-lived URL when viewing/downloading the receipt. Keep signed URLs out of long-lived exports and logs.

### 8. High functional impact: quarterly tax calendar contains an incorrect 2026 deadline

Evidence: [displayed quarters](./src/app/(dashboard)/tax/page.tsx#L187), [seeded filings](./src/services/tax.service.ts#L70).

The Q2 deadline is hard-coded to June 16 for every year. The standard 2026 deadline is June 15, 2026, according to [IRS Publication 505](https://www.irs.gov/publications/p505). Both displayed dates and seeded records inherit the incorrect date.

Fix: use a single verified calendar shared by display and seeding, with year-specific weekend/holiday treatment. Preserve support for taxpayer-specific exceptions. Review already-seeded records through an approved correction process rather than silently changing financial records.

## Additional issues and improvements

### Invoice creation is not atomic

[Creation](./src/services/invoices.service.ts#L180) first saves the header, then saves lines. An ordinary line-insert error attempts a compensating delete, but a thrown timeout exits before that cleanup. The underlying request is not cancelled. The user can see failure even though a header or eventual full invoice persists, and a retry can duplicate work. Use an atomic, idempotent database operation. The unused line-replacement helper also deletes before inserting and ignores delete errors; do not simply wire it into editing as a fix.

### Deferred accounting posting is not atomic or idempotent

[Posting](./src/services/accounting.service.ts#L167) marks the journal posted before adjusting balances, skips account-read failures, ignores account-write results, and performs unlocked read-modify-write balance changes. Failures, retries, and concurrent posting can corrupt balances. Before enabling this deferred module, move posting into a transaction, validate balanced entries and account ownership, and guarantee that a journal can post only once.

### AI output needs enforced constraints, not only prompt instructions

AI schemas mostly accept unconstrained strings/numbers. Dashboard links are accepted as strings and passed to navigation; a prompt instruction requests allowed destinations but code does not enforce them. Enforce a fixed internal-route allowlist, valid dates and amounts, finite bounded quantities, and consistent line totals. Keep user confirmation for financial changes. Redaction regexes are partial filters, not a guarantee that all personal/financial information is removed; minimize the actual fields sent to AI and explain that processing clearly.

### Improve browser response protections

The inspected live dashboard document response included HSTS but did not include Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, or Permissions-Policy. `next.config.js` does not configure these either. Add a tested CSP with appropriate script/connect/image sources and frame restrictions, plus other applicable headers. Start with report-only CSP where needed to avoid breaking Supabase and PDF workflows. This is hardening evidence, not proof of an existing XSS exploit.

### Improve sign-in recovery and public trust information

The public login has no password recovery path, and neither the inspected homepage nor signup exposes privacy/terms/support links. Add password recovery, useful connection-failure guidance, and visible contact/privacy information explaining financial-data and AI processing. Report authentication outages through monitoring rather than leaving users with `Failed to fetch`.

### Validate mobile layout and loading failures next

The dashboard sidebar defaults to an open 256px width, while its header search disappears below the medium breakpoint. A mobile drawer and accessible mobile search would improve small-screen usability. This is a code-derived recommendation; authenticated mobile behavior was not verified because login was blocked.

## Recommended sequence

1. Diagnose the browser's Supabase DNS failure and restore a verifiable QA sign-in path.
2. Protect the AI endpoint; verify deployed RLS against the role matrix; fix CSV export sanitization.
3. Fix AI response parsing, invoice numbering/editing/atomic saving, and the tax calendar.
4. Replace expiring receipt references with durable object paths and authorized downloads.
5. Run two-account authorization tests, authenticated browser workflows, dependency advisory checks, and mobile/accessibility tests before release.

Positive controls already present include receipt file-type/size restrictions, randomized owner-prefixed object names, private receipt storage in migration 019, ownership checks on metrics RPCs, and protected user-field triggers. Their presence in source does not establish that the deployed database has applied them.
