# Solo expense review and accountant packets

Standalone freelancers can mark a saved draft or rejected expense Reviewed, or clear its review, from Expenses and the Review inbox. This is independent of business approval. The database writes the review time, checks the observed record version, and records the change in history. Editing expense details, attachments, or line items clears the marker; existing records begin unreviewed.

Reports → Workspace period report → Export accountant packet downloads a ZIP for a selected date range within the workspace year. It uses the selected currency and cash-received or invoices-issued income basis. Expenses remain captured records; the marker does not decide payment, deductibility, or report inclusion. Rejected and archived expenses are excluded.

The ZIP contains:

- `records.csv`: selected income and expense records, period metadata, basis, and record IDs.
- `receipt-index.csv`: one row per expense, review state, original availability, generated receipt filename, and SHA-256 for included files.
- `receipts/`: unchanged private originals, named by expense ID.
- `README.txt`: packet contents and availability explanations.

Missing objects and unsupported legacy references are explicit index entries. Invalid ownership/path/file data and storage errors stop the entire download. Record and original reads use the authenticated user's ownership boundary and database policies; original URLs are never fetched. Session and active profile are checked again before returning the archive.

Each packet permits at most 100 receipt references, 10 MiB per original, 25 MiB of originals, and 2 MB of CSV/readme metadata. One packet can be prepared per application process at a time. Shorten the date range if it exceeds a limit.

Release requires applying `20261007212446_solo_expense_review.sql` before deploying the app from `main`. The Render data API must reload its schema (the migration sends the notification). No new provider key, model, paid service, or storage bucket is required.

Verification commands:

```sh
npm run lint
npm run build
npm run test:expense-review
npm run test:accountant
npm run test:security:db
npm run test:upgrade
npm run test:upgrade:incremental
```

`npm run test:solo-accountant:render` additionally checks real cookies, PostgREST policies, review history, and private originals against an isolated Render-style rehearsal only: database `127.0.0.1:54399/render_rehearsal`, app `http://127.0.0.1:4193`. It requires the local-only `RENDER_TEST_ADMIN_URL` and never calls an AI provider.
