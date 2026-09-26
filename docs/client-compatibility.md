# Client compatibility before the workflow release

Inspected September 26, 2026. This is a local source comparison, not a test of an installed or published iOS binary. The web baseline is `c9e04b8`. The sibling `amountly-ios` checkout is at `340cb5c`; its Xcode project declares version 1.0/build 1. It already has local changes in AppState, SupabaseClient, AuthService and LoginView; those were preserved. No iOS code was changed or connected to production. App Store/TestFlight versions, active installations and other deployed clients remain unknown.

## Security and financial integrity findings

1. **The iOS CSV encoder does not neutralize spreadsheet formulas.** `alpha/Features/Settings/SettingsView.swift:535` escapes delimiters/quotes but returns other strings unchanged. Values beginning with `=`, `+`, `-` or `@` can be interpreted by spreadsheet software. Expense exports also include `receipt_url` at line 496. An unexpired signed URL would disclose receipt access to the export recipient. Apply the web export escaping and receipt-field exclusions before certifying mobile exports.
2. **Mobile reports do not understand recorded receipts or reversals.** `DashboardRepository.swift:36` treats Paid invoice totals as revenue and uses full invoice totals as outstanding. `TaxRepository.swift:18` caps invoice reads at 500, combines invoice/expense amounts without the web currency/basis rules, and swallows read failures into empty arrays. These screens can disagree with the audited web ledger even if their reads still succeed.
3. **Mobile invoice/payment writes are incompatible with the protected workflow.** Invoice header/line inserts and status updates must be replaced with authenticated RPC calls. Keep the database protections; do not restore direct invoice writes to make an old client work.

Repository references below are relative to `amountly-ios/alpha/`. Line numbers describe the inspected checkout and may drift.

| Area | Observed source behavior | Release impact and required replacement |
| --- | --- | --- |
| Invoice creation | `Core/Repositories/InvoiceRepository.swift:90` inserts a header, then separately inserts lines at 109; computes totals on device | Direct writes are rejected. Use `save_invoice` with a stable request UUID, server totals, allowlisted lines and the loaded version for edits. |
| Issuing / paid status | `InvoiceRepository.swift:136–169` updates status/paid_at directly; status filters at 31 use lowercase | Use `invoice_action` and `record_invoice_payment`. Filters/writes must use uppercase canonical invoice states; display may normalize case. Never infer a receipt from a Paid label. |
| General payments | `Core/Repositories/PaymentRepository.swift:28` writes to `payments`, without an invoice ID | The checked-in web schema defines `invoice_payments`, not this legacy table. Confirm any hosted-only table separately. Invoice receipts require invoice ID, stable request UUID, amount, date and method; corrections use `reverse_invoice_payment`. |
| Time billing | `Features/Invoices/CreateInvoiceSheet.swift:368` calls `TimeEntryRepository.markAsInvoiced`; that method sets `invoice_id` directly at 130 | Protected time linkage rejects this path. Use `create_invoice_from_time`; preserve reservations, released links, retry identity and version conflicts. |
| Expenses | `ExpenseRepository.swift:46–145` directly inserts/updates/deletes; status buttons call `updateStatus` | Valid draft writes and permitted status transitions can still succeed. Deletes, self-approval, edits after submission and forbidden transitions fail. Move creation to `create_money_record`, review to versioned `review_work_record`, and deletion to archive. Do not describe all direct expense calls as blocked. |
| Personal bills | `Core/Models/BillLineItem.swift:237–294` creates, directly marks paid and deletes | Valid creates/pay transitions may still work under triggers, but lack the new request retry/version controls. Deletes are rejected. Use `create_money_record` and `bill_action`; cancel preserves history. |
| Clients/projects | `ClientRepository.swift:131`, `ProjectRepository.swift:79` delete rows | Referenced historical records are protected by foreign keys. Use archive fields and retain historical links. |
| Team | `TeamRepository.swift:43–77` deletes members, changes roles and inserts invites directly | These flows are outside the certified release and can conflict with profile/membership protection. Keep administration unavailable until audited commands and role tests exist. |
| Settings/onboarding | `Core/Services/AuthService.swift`, with pre-existing local changes | Retest profile creation, disabled users, role protections and one-workspace membership before certification. Preference patches should use `set_own_preferences`; established workspace reassignment requires a separate operation. |
| Vendor bills / purchase orders | No corresponding repository or RPC calls found in this checkout | Do not infer support from the web's untracked historical `CHANGELOG-iOS.md`. Any future implementation must use the current command APIs and history. |

## Required compatibility decision

Before production migration, establish whether this iOS build or any other direct-write client is actually distributed and in use. Source version numbers are not proof of release inventory.

- If there are active mobile users, release and validate a compatible mobile build first, or arrange an explicit supported outage/retirement path. App Store removal alone does not disable already-installed apps.
- A web-only maintenance page or client version banner does not block direct Supabase requests. Any maintenance/write gate must apply at the API/database boundary and be rehearsed for all clients.
- Do not weaken RLS, restore direct invoice writes, fabricate receipt history, or convert legacy payments automatically as a compatibility shortcut.
- Read-only access is not automatically safe to call compatible: mobile revenue, balances, tax estimates and exports need the fixes above.

## Mobile acceptance checks for a follow-up implementation

Run against local Supabase with synthetic accounts: owner/admin/member/contractor/freelancer/personal and a separate workspace. Cover draft create/edit/issue, partial and full receipts, correction, stale edits, response loss with the same UUID, time reservations/cancel/rebill, independent expense review, bill cancellation, profile/session expiry, archive preservation and invoice status filtering. Compare report totals with the web for multiple currencies, fiscal boundaries, legacy Paid invoices, reversals and more than 1,000 records. Confirm CSV formula safety and removal of receipt credentials. Do not use production data to populate a mobile simulator for these tests.
