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
- Added `node tests/security-db.cjs --upgrade`: seed the old schema before applying the workflow migrations, compare every pre-existing column across eight tables, preserve a legacy paid invoice and invalid historical work records, verify no payments/events are fabricated, and then run the full authorization/concurrency suite. This passes with synthetic data; it does not replace a staging rehearsal with representative production data or a restore drill.
- Diagnosed the earlier screenshot's Next.js issue: a dashboard AI request logged an error after the origin guard rejected `127.0.0.1` because Next reconstructed the request URL as `localhost`. Optional AI failures no longer create a console-error overlay. The origin guard now accepts equivalent HTTP loopback hosts on the same port only in development. Regression tests reject foreign hosts, different ports, malformed origins and spoofed forwarded headers, and preserve strict production behavior. Local HTTP probes now reach authentication (401 with a deliberately invalid token) instead of incorrectly returning 403. The signed-in dashboard now receives the expected 503 with the local AI provider disabled, renders its fallback, and shows no console errors or Next.js issue badge.
- PDF preview remains blank in the in-app browser. Its iframe does contain a generated 3,934-byte `%PDF-1.3` blob, so generation and display are separate issues. The browser download event did not complete within 15 seconds. A missing dialog description also produces an accessibility warning. Do not treat either PDF display or download as verified; investigate browser support and independently validate the actual document content.

### Follow-up implementation and local-only release checks

The foundation was committed as `1eaf945`. The user requested local testing only; no hosted staging branch, preview deployment, production data copy, or live database change was created for these follow-ups.

Confirmed defects fixed after that checkpoint:

- Stale invoice edits used SQLSTATE `40001`, which the local PostgREST server repeatedly retried until the gateway timed out. The new conflict migration changes only the two explicit optimistic-version exceptions to `PT409`. Real API tests now receive an immediate conflict and a reload message. [Supabase documents this retry behavior](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).
- Fresh authenticated accounts could reach account-type selection without a public profile, then fail the account-type RPC. Profile creation now happens when the user chooses an account type, using their authenticated identity and ordinary RLS. It starts with MEMBER/no organization, ignores role/membership metadata, handles concurrent creation without overwriting existing profiles, and joins only an organization the user owns.
- Authentication callbacks defer asynchronous work outside the callback and discard old profile responses after sign-out. Focused tests cover a delayed profile result after sign-out and sign-in immediately followed by sign-out.
- The invoice dialog now provides an accessible HTML document review and a normal authenticated PDF download. The Node API endpoint uses cookie authentication, RLS, UUID validation, bounded invoice content, sanitized filenames, and private/no-store responses. A Pages API endpoint keeps the PDF renderer on its installed React runtime; the App Router's separately bundled React runtime was incompatible with this renderer. No dependency upgrade or security-header relaxation was needed.
- PDFs include payments recorded and balance due, correct paid-status styling, and timezone-independent calendar dates. Historical paid invoices explicitly state when payment details are unavailable. Issued client data no longer inherits changed live client fields that were absent from the snapshot. Old snapshots that captured only name/email/address do not invent the missing address fields.
- Export fetching is extracted into a service used by the Settings UI so the integration test executes the same pagination/redaction logic as the app.

Verified locally:

- `npm run lint`, `npm run test:security` (11 tests), `npm run test:auth` (6 tests), `npm run test:pdf` (5 tests), `npm run test:security:db`, `npm run test:upgrade`, and the optimized build.
- The final pre-commit coverage pass added eight focused tests: profile setup ignores forged identity/role/workspace metadata, preserves existing disabled profiles, fails closed on lookup/validation errors, and recovers concurrent creation without an upsert; PDF requests reject unsupported methods, malformed identifiers, expired sessions, and oversized legacy records, and return sanitized failures for database/rendering errors. These endpoint failure tests use dependency substitutes; the real local API authorization/download checks above remain separate evidence. All 22 unit/document tests, TypeScript, fresh-install database tests, and upgrade/restore tests passed again. Only tests and these notes changed in this pass, so the previously successful optimized build and browser checks were not repeated.
- Upgrade rehearsal now saves a pre-upgrade PostgreSQL dump, restores it into a separate disposable recovery database, and compares all historical fixture columns across eight tables. This proves the synthetic recovery procedure, not production backup availability.
- Real local Auth/API tests onboard business, freelancer and personal accounts, reject foreign organization joining, test two authenticated sessions for stale edits/concurrent payments, and retry a payment after deliberately discarding its successful response. Disabled users, role changes, and expired tokens are denied through the real API.
- The actual application services retrieve 1,005 invoices and payments despite the 1,000-row API limit, compute all partial balances, export every row, exclude receipt paths/URLs and issued snapshots, and exclude another workspace's records.
- Real Storage upload and signed downloads work. Foreign-workspace signing/uploads, unsupported types, oversize files, and untrusted legacy URL origins are rejected. The application's 60-second signed link expires and a fresh authorized link opens.
- The PDF endpoint renders valid PDF bytes with private/no-store attachment headers; anonymous, malformed, foreign-workspace, and disabled-account requests fail. The in-app browser successfully downloaded the PDF in development and production mode. Its extracted text and rendered page were inspected independently. A 60-line multi-page PDF test also checks currencies, partial balance, issued identity, and legacy payment messaging.
- Production-mode browser sign-in and a new synthetic $10 draft -> issue -> payment flow pass. A fresh production browser tab shows no console warnings/errors. The document dialog fits a 390px viewport without page overflow.
- Local production-mode AI requests on `http://localhost:4174` reach the deliberately disabled-provider fallback (503); foreign origins are rejected (403). This validates authentication/origin/fallback handling, not paid provider generation. The production origin guard is intentionally strict: the `127.0.0.1` alias is not treated as `localhost` outside development.

Repeatable local setup (requires the isolated Supabase CLI stack, Node, PostgreSQL tools, and Poppler):

```sh
node tests/local-app.cjs build
node tests/local-app.cjs start
# In another terminal:
npm run test:release:local
```

Both build and start must receive the local public Supabase configuration because Next embeds public variables at build time. The helper obtains local CLI status without printing credentials, refuses a non-loopback Supabase URL, and disables the AI provider. The integration script also refuses non-local endpoints. It creates synthetic fixture accounts/records in the local stack and retains them for inspection; it never loads production `.env` configuration. Stop only this project's stack after testing and retain its volumes. The conflict migration was applied to the existing local database using SQL for iterative tests; disposable suites always apply all migration files from scratch.

Still required before production rollout:

1. Hosted staging upgrade/recovery with representative data, actual preview-hostname checks, verified production recovery point, migration-history reconciliation, and inventory of older clients (including iOS). Deferred by the user's local-only choice.
2. Live AI provider success/failure verification with explicitly configured test credentials. No provider requests were sent by the local tests.
3. Browser-level payment response-loss/connection-loss testing. Attempted browser offline emulation did not interrupt the cross-origin API request, so it is not counted as a successful fault-injection test. API-level retry/idempotency and concurrency checks do pass.
4. Full email-verification delivery/new-signup UI and forced-expiry UI recovery on the intended hosted auth configuration. Local Auth/RLS onboarding, expired-token rejection, and auth race tests are verified; hosted delivery/redirect behavior is not.


The three new timestamped migrations (foundation, invoice workflow, and conflict response) and the web application must be released together in a controlled window. The old client uses direct invoice writes that these migrations intentionally reject; the new client requires the new columns/tables/RPCs. Do not deploy either half independently and assume compatibility. Inventory other clients, including any iOS build, before release.

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
