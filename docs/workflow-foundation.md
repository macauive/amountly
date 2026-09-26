# Workflow foundation: implementation and release notes

This is the first implementation of the recommended sequence: security and preservation, then the complete invoice-to-payment journey, followed by supporting navigation and dashboard improvements. The live app and production database have not been changed. The isolated test services were stopped after verification; synthetic data is retained in local Supabase volumes for a future test run.

## Ownership and permission decisions

Existing business organization IDs and freelancer user IDs are retained. The migrations strengthen these boundaries without moving historical records between workspaces. A full conversion of personal accounts into workspace rows is still a separate data migration; this change does not claim to complete it.

All existing public-table policies receive an active-account restriction, with narrowly scoped profile/onboarding exceptions. Disabled users can read their own profile to receive a useful access message, but cannot access financial records or receipts. Token refresh rechecks profile status. Organization ownership cannot be changed through an ordinary browser update. Project/client and expense/time parent references must match the owning workspace.

Expense and time approval now require an independent owner/admin in the same organization, preserving submitted/approved values. Submitted or approved records cannot be deleted through ordinary client requests. Expense lines are locked after submission. New expense amounts must be positive; duration/rate constraints protect new time entries. Historical anomalies are preserved through NOT VALID constraints and need a separate review.

Clients and projects are archived through the UI. Database foreign keys prevent deleting a client with invoices or a project with time entries. Archived records remain attached to historical invoices and time entries; a restore/list-archived interface remains future work.

## Invoice workflow

- Drafts save header, calculated totals, and ordered lines in one transaction. The server validates allowlisted input, dates, currency, line counts, lengths, and numeric ranges.
- Workspace-scoped counters assign readable numbers under concurrency. Custom numbers are unique within the workspace.
- Edits require the version the user loaded; stale edits fail rather than overwrite another user's work.
- Issuance locks the document and captures the client's issued name/email/address. Issuing does not send email.
- Issued invoices can be cancelled only while unpaid. Issued/paid invoices cannot be deleted through the workflow.
- Payments store amount, date received, method, reference, actor, and timestamp. They record money already received; they do not initiate transfers or card charges.
- An invoice lock serializes payments. Overpayment is rejected; repeated identical payment IDs return the existing result. Payments cannot be updated/deleted through the browser API.
- Partial payments leave an outstanding balance. The final payment derives paid status and paid date. Overdue is computed from the due date and balance.
- Existing PAID invoices retain their status. No fabricated payment dates or cash transactions are created; the detail page identifies missing historical payment evidence.
- Detail pages show lines, payments, balance, and activity. Draft edits correctly reload persisted lines and date values.

Privileged implementations live in an unexposed private schema with a fixed search path, explicit actor checks and permissions. Public RPC facades execute as caller. Direct invoice/line writes are blocked, including attempts to set totals or PAID status directly. The API schemas must remain restricted to the configured public schemas; do not expose `amountly_private`.

The prior automatic time-to-invoice drafting action is withheld because it did not reserve/link entries and could bill the same work twice. Manual invoice lines and time tracking remain available. Safely linking time entries to drafts/issued invoices is still required before restoring that action.

## Supporting UX and data handling

Navigation groups existing destinations under Overview, Money in, Money out, Contacts, Work, Reports & taxes, and Workspace. Capabilities still control visibility. Mobile uses a focus-managed drawer instead of permanently consuming 256 pixels of content width.

Dashboard figures and deterministic attention counts precede optional suggestions. Cash received counts payment events by date, including partial payments. Legacy PAID flags without recorded payments are excluded. Open invoice balances deduct payments. Multiple invoice currencies are not silently added into a single dashboard currency.

Invoice and payment reads, and CSV exports, paginate past the default row limit. Exports omit stored receipt links/paths and issued snapshots. New receipt uploads store an object path; opening a receipt requests a 60-second signed URL. Legacy URLs are accepted only for the configured Supabase origin and receipts bucket, then refreshed. Already issued old signed URLs can remain valid until their original expiry.

## Verification

- TypeScript (`npm run lint`), security unit suite, disposable PostgreSQL integration suite, and production build.
- Real PostgreSQL tests cover inactive users, self-approval, cross-workspace parents, owner reassignment, destructive deletes, direct financial writes, stale edits, invalid lines/rollback, contractor and freelancer permissions, cancellation, duplicate payment retries, and concurrent numbering/payment requests.
- Local Supabase API/browser check: create a $250 invoice, edit persisted lines to $300, issue it, record $100, verify $200 balance and $100 dashboard cash received, then record $200 and verify PAID with zero balance and two payment events.
- In-app browser at 390px: main and document widths both 390px; drawer opens and navigation completes. Desktop detail inspected at 1280px.
- Local catalog checks: both new public tables have RLS; anonymous roles cannot execute private functions or use the private schema; browser roles cannot write the payment table directly.
- AI provider traffic was disabled in the isolated preview. This validates manual workflows and fallback behavior, not live AI generation.

## Release requirements

### Additional pre-release checks (September 25, 2026)

- Re-ran TypeScript, production build, 11 security unit tests, and the fresh-install database suite successfully. `npm run lint` currently runs TypeScript only; it is not an ESLint check.
- Added `node tests/security-db.cjs --upgrade`: seed the old schema before applying the two workflow migrations, compare every pre-existing column across eight tables, preserve a legacy paid invoice and invalid historical work records, verify no payments/events are fabricated, and then run the full authorization/concurrency suite. This passes with synthetic data; it does not replace a staging rehearsal with representative production data or a restore drill.
- Diagnosed the earlier screenshot's Next.js issue: a dashboard AI request logged an error after the origin guard rejected `127.0.0.1` because Next reconstructed the request URL as `localhost`. Optional AI failures no longer create a console-error overlay. The origin guard now accepts equivalent HTTP loopback hosts on the same port only in development. Regression tests reject foreign hosts, different ports, malformed origins and spoofed forwarded headers, and preserve strict production behavior. Local HTTP probes now reach authentication (401 with a deliberately invalid token) instead of incorrectly returning 403. The signed-in dashboard now receives the expected 503 with the local AI provider disabled, renders its fallback, and shows no console errors or Next.js issue badge.
- PDF preview remains blank in the in-app browser. Its iframe does contain a generated 3,934-byte `%PDF-1.3` blob, so generation and display are separate issues. The browser download event did not complete within 15 seconds. A missing dialog description also produces an accessibility warning. Do not treat either PDF display or download as verified; investigate browser support and independently validate the actual document content.

Before calling this release ready, complete:

1. Fix or account for the PDF preview/download failure, inspect exported invoice values (including partial payments, currencies and issued client snapshots), and remove the dialog accessibility warning.
2. Rehearse a representative database upgrade and recovery on staging; inventory other clients and use a coordinated app/database rollout because old direct invoice writes become invalid.
3. Smoke-test the production build on the actual preview hostname, including valid authentication, allowed AI requests, provider failures and cross-origin rejection. Live provider generation has not been tested locally.
4. Exercise new-account onboarding, role changes, disabled/expired sessions, and two browser sessions editing or recording payments, including response loss and retry. Database concurrency tests pass but do not establish UI recovery behavior.
5. Exercise receipt upload/access/expiry and cross-workspace denial through real Storage APIs, plus exports and invoice lists with more than 1,000 records. Verify completeness and that receipt credentials are absent.

The two new timestamped migrations and the web application must be released together in a controlled window. The old client uses direct invoice writes that these migrations intentionally reject; the new client requires the new columns/tables/RPCs. Do not deploy either half independently and assume compatibility. Inventory other clients, including any iOS build, before release.

Before production rollout: verify live migration history, take/verify the database recovery point, inventory malformed legacy invoices and work records, confirm private-schema API exclusion, and rehearse the migration against a staging copy. Migration 011 now declares the historically missing owner_id prerequisite so a fresh local database no longer requires a test-only patch. Already applied migration history is not rewritten.

No production migration or deployment has been executed. Production Supabase advisors and leaked-password protection settings have not been changed. The installed CLI lacks local advisor support; focused local catalog checks are recorded above instead.

## Remaining sequence

1. Add audited payment corrections/reversals and safely link tracked time to billing. Reconcile legacy payment evidence with user review.
2. Apply the same command/record-history pattern to bills and expenses, including duplicate prevention and a shared capture/review inbox.
3. Unify the workspace membership model and customer/vendor contacts with an explicit historical-data migration.
4. Repair tax-year/basis/currency reporting and settings persistence; update tax rules from authoritative current sources before presenting estimates as reliable.
5. Expand role/relationship coverage for deferred payroll, inventory and accounting before enabling them. Complete CSP and remaining deployment-level hardening from the original audit.

This foundation does not certify the whole product as a complete accounting system. The remaining tax/reporting and advanced-module findings in the original audit still apply.

Database policy design follows the [Supabase RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security), including the distinction between table grants and row policies.
