# Receipt capture for freelancers and solo businesses

Amountly's first document ingestion workflow turns one purchase receipt into an editable expense proposal. The audience is freelancers and solo service businesses keeping their own records. Existing invoices, expenses and reports remain the core product.

## First release

Capture starts with one choice: Receipt file, Paste text or Manual entry. Only the chosen input method is shown; project, description and notes are under Add details. The expense form reads one JPEG, PNG, WebP or unencrypted PDF receipt at a time. Files are limited to 10 MB, images to one frame and 25 megapixels, and PDFs to five pages. Extraction proposes merchant, transaction date, total, explicit currency and category. Missing or ambiguous values require manual input. Invoices, statements, refunds and unrelated documents do not become expense proposals.

Users explicitly choose extraction and review the proposed fields against the original. A review acknowledgment is required before saving an extracted proposal. The existing expense save command creates the record and the original receipt is attached through private storage. Extraction itself stores neither an expense nor a receipt. New captures stay in form memory unless the user explicitly chooses **Keep for later**. This stores an unfinished proposal and its selected original privately, separately from expenses; up to ten captures can be resumed from Expenses or the Review inbox. Restoring a proposal always resets the review acknowledgement. Account changes clear the editor. Final saving continues to use the existing financial command; kept captures reuse a stable record ID to prevent a second expense after a retry or reload.

Possible duplicate warnings compare loaded expenses by merchant, date, amount and currency. They assist review rather than guaranteeing duplicate detection. Existing request IDs prevent repeated saves of the same uncertain submission.

## Solo-business workflow

The dashboard and floating quick actions open the receipt section of the expense form. Dashboard activity and the Review inbox open the exact saved expense. Links resolve only against expenses returned by the authenticated service; unavailable records produce a generic notice. Finalized records open for viewing, while editing remains limited to the current user's draft or rejected records. Navigation cannot replace an open editor or an uncertain save, and changing accounts resets editor state.

The expense list combines merchant/description search with inclusive date, category and status filters. The dashboard draft count opens the draft filter. Summary totals continue to include all loaded expenses with currencies kept separate; the list explicitly states its filtered count.

New users see one explicit freelancer/solo-business setup action. Loading the page does not create a profile. Setup uses the existing authenticated freelancer command; existing account types and business recovery paths remain supported.

## Processing and privacy

The authenticated endpoint accepts only a raw file body, verifies image signatures before native decoding and consumes the existing durable AI quota. Images are resized for inference; PDFs are checked in a worker with JavaScript evaluation disabled, a 128 MB V8 heap limit and a 10-second timeout. A declared embedded-image size limit constrains PDF decoding. These settings do not impose an absolute process memory ceiling, and PDF.js may omit oversized images instead of rejecting an entire PDF. Upload and provider timeouts and process concurrency limits also bound work. Provider output receives strict schema validation; errors never include documents, credentials or raw provider responses.

Extraction sends the selected document to OpenAI. Binary documents cannot be reliably redacted before inference, so the form discloses that transfer before the action. Only selected financial fields return, with common sensitive text patterns redacted. Responses use `store:false`; this is not a zero retention guarantee. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

This short, user initiated extraction runs synchronously and can be retried manually after a definite failure. Explicitly kept proposals use the private Render capture table described below. This adds neither a general document library nor processing jobs, batch uploads or automatic financial posting. Those require a separately scoped release. PDF validation requires Node 22.13 or later; the worker and parser are included in the standalone build.

## Next workflow

Supplier invoices may later produce vendor bill proposals with their own review and validation. Statement imports and reconciliation, personal finance workflows, payroll, inventory, tax filing and team administration are deferred. Expanding supported documents requires evidence that the receipt workflow saves users time at an acceptable correction rate and processing cost.

## Verification

`npm run test:receipts` runs 39 focused tests covering file content, upload bounds, authentication and origin checks, quota failures, invalid provider output, cancellation, review requirements, stale results, account changes, uncertain saves and StrictMode effect replay. `npm run test:expense-workflow` covers link validation, filters, dashboard/Review navigation and explicit solo setup. The combined receipt, workflow, auth, security, reporting, export, financial-review, capture and PDF suites pass 125 tests. Type checking and `npm run build -- --webpack` pass; the default Turbopack build hits a local process/port permission failure.

`npm run test:receipts:render` exercises real Better Auth cookie sessions and signed PostgREST quota calls against a disposable Render rehearsal database. It checks image/PDF validation, quota ownership and exhaustion, origin protection, inactive accounts, session revocation and the absence of financial or receipt-storage writes. Provider responses are synthetic, and unexpected outbound requests and email are forbidden. The test refuses databases outside `127.0.0.1:54399/render_rehearsal`; it requires an initialized local rehearsal and runtime role configuration. Auth, reporting, workspace exports, deterministic financial review and invoice PDF regression suites also pass (51 tests).

In-app browser verification used a disposable local Supabase database and synthetic freelancer records. Live OpenAI extraction succeeded for both an image and a PDF. Saving the reviewed image created one draft expense with the exact original bytes privately attached; an anonymous download was denied. The PDF proposal triggered the duplicate warning and was discarded without saving. Manual edits and file removal reset review confirmation. The receipt dialog fit a 390-pixel viewport without horizontal overflow.

The follow-through workflow was separately verified in the in-app browser with AI disabled and synthetic records: repeated receipt entry and file focus, exact dashboard/Review links, finalized-record viewing, foreign/malformed link denial, combined filters, inclusive dates, invalid ranges, no-match/reset states and draft counts passed. Filters and the receipt dialog fit a 390-pixel viewport, and the mobile quick-action sheet closes after selecting receipt entry. A confirmed new account had no profile before the explicit setup action and reached the freelancer dashboard afterward.

The full production Dockerfile also builds on Linux amd64 with Node 24, including the default Turbopack build. Its traced dependencies pass eight preprocessing tests and a scanned-JPEG PDF worker probe with network disabled and no optional canvas package. Production page/assets, CSP, cross-origin rejection and fail-closed health checks pass. These pre-release checks use isolated test data and services.

The release smoke check exposed a Turbopack worker transform that changed PDF bytes into an ordinary object. The PDF validator now constructs the traced Node worker without that transform, preserving the typed bytes and existing limits. After a default production build, `node --test tests/receipt-production.test.cjs` runs two checks against the actual bundled validator; raw worker and source-level tests alone did not catch this failure. Inside the production container, set `AMOUNTLY_STANDALONE_ROOT=/app` when running that test.

The runtime dependency `source-map-js` is patched to 1.2.2 for its [indexed source-map denial-of-service advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). The production-only dependency audit reports no findings. Seven development-dependency findings remain; PDF.js and Sharp have no reported findings in that audit.

## Capture, search and source review

This release adds one-file resumable captures, persistent record search, and original-document review. The new **Find** header works throughout the workspace, including mobile. Search uses existing authenticated services and capability checks; it performs no AI request. It combines names, descriptions, amounts, record types, status and dates, with type/date/status/receipt filters. Exact title matches rank first. Filters remain in the URL through record inspection and correction. Invoice and bill lists share the same filter contract; expense filters now also survive navigation. Search shows no partial results when a source fails.

Images can be zoomed, and PDFs are rendered to a bounded canvas with page controls and no interactive annotations or PDF scripting. The original can still be downloaded. Supporting-record screens show the saved fields and original together, with a link to the exact correction record; financial-review return links retain the period, view and selected finding.

`ops/render/capture-drafts.sql` is an additive, idempotent private-schema migration for the Render backend. It was applied to the intended production `amountly_db` database on October 12, 2026, after the fresh recovery export restored successfully and the migration preserved all 55 existing table digests. The owner-only API stores original bytes and typed proposals, checks active-account RLS, limits each owner to ten captures, serializes admission, and rejects stale revisions. File reads require the same revision as their metadata. Repeating an identical save recovers a lost response. The draft is removed only after a confirmed expense save or an explicit discard confirmation. Existing financial save permissions, receipt review and optimistic versions remain authoritative.

The forward migration `ops/render/receipt-storage-quota.sql` must be applied as
the schema owner after both private storage tables exist and before releasing
the corresponding upload handlers. It has not been applied to production by
the security-fix task. Uploads fail closed until the expected triggers exist.
The triggers share a 250 MiB / 1,000 original-file budget per owner and a
1 GiB / 10,000 original-file service budget across saved receipts and private
capture originals. They update private counters atomically on insert, replace
and delete; client roles cannot alter counters or disable triggers. Existing
originals and financial records are preserved, including owners already above
a budget. Reads and size-neutral metadata updates remain available; additional
allocation is denied with HTTP 413. Reapplying the migration rebuilds accounting
under table locks. Completing a kept capture atomically promotes its exact original
instead of storing a second copy, so it works at a full budget. The capture keeps
an owner-bound reference to that original until the expense save is confirmed;
retries and reopening after an unsuccessful save preserve the original.
Deployment operators should review these conservative limits
against database headroom before separately authorizing a release.

Focused local regression commands:

```sh
node --test tests/receipt-storage-quota.test.cjs tests/capture-drafts.test.cjs
node --test tests/integration-admission.test.cjs tests/chatgpt-codex.test.cjs
```

`node --test tests/record-search.test.cjs tests/capture-drafts.test.cjs` covers filter/link validation plus real disposable PostgreSQL draft ownership, update conflicts, concurrent capacity, exact-original retrieval, malformed uploads and cancellation. The database test creates its own private Unix-socket cluster and never accepts a deployed database URL.

For a sample preview, run `node tests/improvements-preview.cjs` from an isolated copy without environment files. It binds only to `127.0.0.1:4174`, renders the actual Next UI, uses synthetic financial records and extraction responses, and stores drafts through the actual draft handler in a disposable PostgreSQL cluster. Auth identity and financial command responses are simulated; this is not production-authentication, provider-accuracy or deployment verification. No email or external financial service is called.

## Local release checks for this candidate (October 12, 2026)

The four additional release checks ran against isolated synthetic records. The final Linux amd64 Docker image passes its Node 24 typecheck and default Turbopack build, plus both bundled PDF-validator regressions. The affected source suites pass 200 tests, including actual PostgreSQL draft RLS and capacity checks. These local checks made no production changes, real financial record changes, provider requests or emails.

Real HTTP Better Auth sessions were tested against the production image and PostgreSQL 17: owner-only draft metadata/originals, cross-origin denial, inactive/disabled accounts, immediate session revocation, exact private bytes and the unexposed private table all pass. The capture migration was replayed against the full Render schema both before and after keeping an original; private draft content and existing public rows were preserved. The synthetic database also restored to PostgreSQL 17 with per-table COPY row digests checked.

The in-app browser covered production-CSP PDF paging, two-tab stale draft updates, lost save confirmation, failed cleanup after one confirmed expense save, and an account switch during a delayed original-file response. A temporary loopback transport adapter translated the production HTTPS origin and Secure cookie names for these synthetic accounts only. This verifies the actual production UI, API and database without installing a certificate authority or changing browser trust. Secure/HttpOnly cookie issuance was checked separately through the actual auth endpoint; Hosted TLS/cookie delivery and the production recovery point are verified separately at release time.

The checks uncovered and fixed three issues:

- Render auth tabs did not synchronize session changes, allowing a late response to reopen an old account's capture. Each browser client now owns its listeners, broadcasts only a change marker, immediately clears private UI, and revalidates the HttpOnly session. Focus checks cover suspended tabs or browsers without BroadcastChannel. Delayed old session reads cannot restore stale state.
- Financial commands store calendar dates at UTC midnight, but an offset serialization could display or filter them as the previous day. The existing shared date conversion now recovers the UTC day. Search, duplicate warnings, financial review and reports reuse it; expense query boundaries explicitly specify UTC, including inclusive end-date filtering.
- Exact-record inspection inherited the optional financial-review flag. Authenticated supporting-record reads now serve core search independently of that flag; synthetic bypass remains explicitly restricted to loopback development.

`node --test tests/render-browser-auth.test.cjs tests/financial-date.test.cjs` covers the new auth and date regressions. `node --import tsx tests/render-improvements-local.ts` covers real HTTP auth, full-schema migration replay and UTC-boundary export/record inspection; it refuses every database except `127.0.0.1:54399/render_rehearsal`, expects the local production app at port 4192 with `https://amountly.local.invalid` as its configured origin, and needs an initialized full Render rehearsal. Its accounts and records are synthetic and remain only in that disposable database. Optional `RENDER_TEST_BROWSER_FIXTURE` writes generated browser-fixture credentials to a caller-selected private local test file; omit it for ordinary test runs. Never run this suite with production credentials or against a production database.

## Production recovery and migration verification (October 12, 2026)

Render's managed recovery window was checked as three days. A fresh logical export completed at 17:48 UTC and was saved outside Git with owner-only permissions. Its SHA-256 is `1cb0b068d578175fe973d38fd5bf041e7de822285cb2c958119a82ee3ddb4730`. The `amountly_db` export restored into isolated, network-disabled PostgreSQL 17. Applying the release migration left all 55 existing table row digests unchanged.

Production migration SHA-256 `473a5cb97640a435c10ea6e9f580bcb30d1285ff3dec8847e72b234fd5606e97` was then verified and applied transactionally through Render's internal connection. Database identity and the absent capture table were checked first. Within the same transaction, all 55 existing table counts and row digests remained unchanged; the new table has RLS enabled and its owner policy. External PostgreSQL access stayed blocked, and owner credentials were not added to runtime configuration.

The previous live application commit `74ccd8dd0ae0f3a70d3a4e49439bb5c8010ec47d` is the application rollback point. The additive private table can remain when rolling back the application; do not drop private captures as part of an application rollback. Render auto-deploy remains off, so the intended release commit is selected explicitly.
