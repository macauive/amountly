# Receipt capture for freelancers and solo businesses

Amountly's first document ingestion workflow turns one purchase receipt into an editable expense proposal. The audience is freelancers and solo service businesses keeping their own records. Existing invoices, expenses and reports remain the core product.

## First release

The expense form reads one JPEG, PNG, WebP or unencrypted PDF receipt at a time. Files are limited to 10 MB, images to one frame and 25 megapixels, and PDFs to five pages. Extraction proposes merchant, transaction date, total, explicit currency and category. Missing or ambiguous values require manual input. Invoices, statements, refunds and unrelated documents do not become expense proposals.

Users explicitly choose extraction and review the proposed fields against the original. A review acknowledgment is required before saving an extracted proposal. The existing expense save command creates the record and the original receipt is attached through private storage. Extraction itself stores neither an expense nor a receipt. Drafts stay in form memory; closing or reloading discards them.

Possible duplicate warnings compare loaded expenses by merchant, date, amount and currency. They assist review rather than guaranteeing duplicate detection. Existing request IDs prevent repeated saves of the same uncertain submission.

## Processing and privacy

The authenticated endpoint accepts only a raw file body, verifies image signatures before native decoding and consumes the existing durable AI quota. Images are resized for inference; PDFs are checked in a worker with JavaScript evaluation disabled, a 128 MB V8 heap limit and a 10-second timeout. A declared embedded-image size limit constrains PDF decoding. These settings do not impose an absolute process memory ceiling, and PDF.js may omit oversized images instead of rejecting an entire PDF. Upload and provider timeouts and process concurrency limits also bound work. Provider output receives strict schema validation; errors never include documents, credentials or raw provider responses.

Extraction sends the selected document to OpenAI. Binary documents cannot be reliably redacted before inference, so the form discloses that transfer before the action. Only selected financial fields return, with common sensitive text patterns redacted. Responses use `store:false`; this is not a zero retention guarantee. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

This short, user initiated flow runs synchronously and can be retried manually after a definite extraction failure. It does not add a document library, durable processing jobs, batch uploads, automatic financial posting or a new database model. Those require a separately scoped release. PDF validation requires Node 22.13 or later; the worker and parser are included in the standalone build.

## Next workflow

Supplier invoices may later produce vendor bill proposals with their own review and validation. Statement imports and reconciliation, personal finance workflows, payroll, inventory, tax filing and team administration are deferred. Expanding supported documents requires evidence that the receipt workflow saves users time at an acceptable correction rate and processing cost.

## Verification

`npm run test:receipts` runs 33 focused tests covering file content, upload bounds, authentication and origin checks, quota failures, invalid provider output, cancellation, review requirements, and stale results. Existing security and text capture tests, type checking, and the production build also pass.

`npm run test:receipts:render` exercises real Better Auth cookie sessions and signed PostgREST quota calls against a disposable Render rehearsal database. It checks image/PDF validation, quota ownership and exhaustion, origin protection, inactive accounts, session revocation and the absence of financial or receipt-storage writes. Provider responses are synthetic, and unexpected outbound requests and email are forbidden. The test refuses databases outside `127.0.0.1:54399/render_rehearsal`; it requires an initialized local rehearsal and runtime role configuration. Auth, reporting, workspace exports, deterministic financial review and invoice PDF regression suites also pass (51 tests).

In-app browser verification used a disposable local Supabase database and synthetic freelancer records. Live OpenAI extraction succeeded for both an image and a PDF. Saving the reviewed image created one draft expense with the exact original bytes privately attached; an anonymous download was denied. The PDF proposal triggered the duplicate warning and was discarded without saving. Manual edits and file removal reset review confirmation. The receipt dialog fit a 390-pixel viewport without horizontal overflow.

The PDF worker also parsed a text and image PDF from a physically isolated copy of the standalone build, with no dependency fallback to the source checkout. No production database changes or deployment were performed. The existing dependency audit reports eight unrelated findings; the new PDF.js and Sharp versions have no reported findings in that audit.
