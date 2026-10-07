# Receipt capture for freelancers and solo businesses

Amountly's first document ingestion workflow turns one purchase receipt into an editable expense proposal. The audience is freelancers and solo service businesses keeping their own records. Existing invoices, expenses and reports remain the core product.

## First release

The expense form reads one JPEG, PNG, WebP or unencrypted PDF receipt at a time. Files are limited to 10 MB, images to one frame and 25 megapixels, and PDFs to five pages. Extraction proposes merchant, transaction date, total, explicit currency and category. Missing or ambiguous values require manual input. Invoices, statements, refunds and unrelated documents do not become expense proposals.

Users explicitly choose extraction and review the proposed fields against the original. A review acknowledgment is required before saving an extracted proposal. The existing expense save command creates the record and the original receipt is attached through private storage. Extraction itself stores neither an expense nor a receipt. Drafts stay in form memory; closing or reloading discards them.

Possible duplicate warnings compare loaded expenses by merchant, date, amount and currency. They assist review rather than guaranteeing duplicate detection. Existing request IDs prevent repeated saves of the same uncertain submission.

## Solo-business workflow

The dashboard and floating quick actions open the receipt section of the expense form. Dashboard activity and the Review inbox open the exact saved expense. Links resolve only against expenses returned by the authenticated service; unavailable records produce a generic notice. Finalized records open for viewing, while editing remains limited to the current user's draft or rejected records. Navigation cannot replace an open editor or an uncertain save, and changing accounts resets editor state.

The expense list combines merchant/description search with inclusive date, category and status filters. The dashboard draft count opens the draft filter. Summary totals continue to include all loaded expenses with currencies kept separate; the list explicitly states its filtered count.

New users see one explicit freelancer/solo-business setup action. Loading the page does not create a profile. Setup uses the existing authenticated freelancer command; existing account types and business recovery paths remain supported.

## Processing and privacy

The authenticated endpoint accepts only a raw file body, verifies image signatures before native decoding and consumes the existing durable AI quota. Images are resized for inference; PDFs are checked in a worker with JavaScript evaluation disabled, a 128 MB V8 heap limit and a 10-second timeout. A declared embedded-image size limit constrains PDF decoding. These settings do not impose an absolute process memory ceiling, and PDF.js may omit oversized images instead of rejecting an entire PDF. Upload and provider timeouts and process concurrency limits also bound work. Provider output receives strict schema validation; errors never include documents, credentials or raw provider responses.

Extraction sends the selected document to OpenAI. Binary documents cannot be reliably redacted before inference, so the form discloses that transfer before the action. Only selected financial fields return, with common sensitive text patterns redacted. Responses use `store:false`; this is not a zero retention guarantee. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

This short, user initiated flow runs synchronously and can be retried manually after a definite extraction failure. It does not add a document library, durable processing jobs, batch uploads, automatic financial posting or a new database model. Those require a separately scoped release. PDF validation requires Node 22.13 or later; the worker and parser are included in the standalone build.

## Next workflow

Supplier invoices may later produce vendor bill proposals with their own review and validation. Statement imports and reconciliation, personal finance workflows, payroll, inventory, tax filing and team administration are deferred. Expanding supported documents requires evidence that the receipt workflow saves users time at an acceptable correction rate and processing cost.

## Verification

`npm run test:receipts` runs 39 focused tests covering file content, upload bounds, authentication and origin checks, quota failures, invalid provider output, cancellation, review requirements, stale results, account changes, uncertain saves and StrictMode effect replay. `npm run test:expense-workflow` covers link validation, filters, dashboard/Review navigation and explicit solo setup. The combined receipt, workflow, auth, security, reporting, export, financial-review, capture and PDF suites pass 125 tests. Type checking and `npm run build -- --webpack` pass; the default Turbopack build hits a local process/port permission failure.

`npm run test:receipts:render` exercises real Better Auth cookie sessions and signed PostgREST quota calls against a disposable Render rehearsal database. It checks image/PDF validation, quota ownership and exhaustion, origin protection, inactive accounts, session revocation and the absence of financial or receipt-storage writes. Provider responses are synthetic, and unexpected outbound requests and email are forbidden. The test refuses databases outside `127.0.0.1:54399/render_rehearsal`; it requires an initialized local rehearsal and runtime role configuration. Auth, reporting, workspace exports, deterministic financial review and invoice PDF regression suites also pass (51 tests).

In-app browser verification used a disposable local Supabase database and synthetic freelancer records. Live OpenAI extraction succeeded for both an image and a PDF. Saving the reviewed image created one draft expense with the exact original bytes privately attached; an anonymous download was denied. The PDF proposal triggered the duplicate warning and was discarded without saving. Manual edits and file removal reset review confirmation. The receipt dialog fit a 390-pixel viewport without horizontal overflow.

The follow-through workflow was separately verified in the in-app browser with AI disabled and synthetic records: repeated receipt entry and file focus, exact dashboard/Review links, finalized-record viewing, foreign/malformed link denial, combined filters, inclusive dates, invalid ranges, no-match/reset states and draft counts passed. Filters and the receipt dialog fit a 390-pixel viewport, and the mobile quick-action sheet closes after selecting receipt entry. A confirmed new account had no profile before the explicit setup action and reached the freelancer dashboard afterward.

The full production Dockerfile also builds on Linux amd64 with Node 24, including the default Turbopack build. Its traced dependencies pass eight preprocessing tests and a scanned-JPEG PDF worker probe with network disabled and no optional canvas package. Production page/assets, CSP, cross-origin rejection and fail-closed health checks pass. These pre-release checks use isolated test data and services.

The runtime dependency `source-map-js` is patched to 1.2.2 for its [indexed source-map denial-of-service advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). The production-only dependency audit reports no findings. Seven development-dependency findings remain; PDF.js and Sharp have no reported findings in that audit.
