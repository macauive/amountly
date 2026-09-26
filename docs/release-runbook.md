# Workflow release and recovery plan

Prepared September 26, 2026. **Not executed.** Local-only testing remains in effect. The user confirmed that pushing deploys to production. The current workflow baseline is `c9e04b8`; the subsequent authenticated CSV-download change must be reviewed/tested and assigned its own release commit before rollout. Do not push a preparation commit or assume a feature-branch preview uses an isolated database.

This runbook supersedes the older checkpoint-specific release lists in `workflow-foundation.md`. See [current implementation evidence](workflow-expansion.md) and [the mobile compatibility findings](client-compatibility.md).

## Current release decision: hold

Local checks cover the web workflow, authorization, database upgrade/restore, concurrency and response-loss recovery. They do not establish production migration history, backup availability, installed client compatibility or hosted configuration. The checked-out iOS client has confirmed incompatible invoice/payment paths and unsafe export behavior. No production rollout is authorized or ready on that evidence alone.

## 1. Freeze the candidate and record the actual deployment inventory

1. Review the complete commit range since the *verified currently deployed* web revision. Do not assume the last local commit, local `origin/main`, or a historical deployment note is the live version.
2. Identify active web, iOS/TestFlight/App Store and other clients. Resolve the compatibility matrix before release. Preserve unrelated work and exclude `.env*`, local instructions, `.gitignore`, screenshots and QA credentials from commits.
3. Record the final source SHA, dependency lockfile, full migration file hashes, approved database target, prior compatible deployment and release owner in the protected release record. Keep credentials and private URLs out of repository docs and logs.
4. Inspect the actual Git-to-Vercel production branch, automatic promotion, preview database variables, auth redirect allowlist and production environment. Only record configuration names/status in the repository. No build using `tests/local-app.cjs` is deployable: it embeds loopback Supabase configuration and disables the AI provider.

## 2. Reconcile the database and inspect historical data

These are future hosted read-only actions after the local-only restriction changes. Confirm the intended project before each command; discover CLI help on that host. Current local CLI help supports `supabase migration list --linked` and `supabase db push --linked --dry-run`. A dry run is a migration inventory, not a data validation or successful rehearsal. No hosted command in this document has been run for this release.

Compare the entire repository migration history with hosted history and live catalog definitions. There are older numbered migrations as well as eleven timestamped workflow migrations. The missing `owner_id` prerequisite was added to historical migration 011 for fresh installations; editing that file does not update an already-migrated database. Investigate any mismatch and prepare a separately reviewed forward migration if needed. Do not blindly use `--include-all`, mark unapplied SQL as applied, replay an applied migration or assume all eleven are pending.

The workflow files must be applied in this order if absent:

| Order | Migration | Main dependency/change |
| --- | --- | --- |
| 1 | `20260926021157_workflow_foundation.sql` | Active actors, ownership/approval protections, archive fields |
| 2 | `20260926021337_invoice_payment_workflow.sql` | Invoice commands, counters, receipts, events and direct-write protections |
| 3 | `20260926030303_invoice_conflict_response.sql` | Immediate version conflicts using `PT409` |
| 4 | `20260926033451_payment_corrections_time_billing.sql` | Receipt reversals and time reservation/link commands |
| 5 | `20260926034735_money_out_review_history.sql` | Bills/expenses/vendor bills, approval/version checks and history |
| 6 | `20260926035720_single_workspace_contacts.sql` | Membership backfill and contact preservation |
| 7 | `20260926040030_settings_reporting_preferences.sql` | Validated preferences and quarterly reminders |
| 8 | `20260926040928_deferred_module_boundaries.sql` | Deferred module write restrictions |
| 9 | `20260926044850_retryable_money_capture.sql` | Private immutable request ledger and money capture |
| 10 | `20260926045913_legacy_payment_review.sql` | Evidence-based legacy Paid review |
| 11 | `20260926050430_purchase_order_workflow.sql` | Atomic PO commands, versions, history and nullable historical currency |

Review aggregate counts first. Keep any necessary row-level investigation inside the approved environment, with no personal data in chat/commits. Check orphaned or mismatched workspace/parent references, profiles without valid memberships, duplicate workspace invoice numbers, unsupported states, invalid amounts/dates, currency gaps, existing `preferences` columns, pre-existing object names and retained legacy receipt URLs. Verify invoice Paid labels separately from receipt evidence. Preserve anomalies for explicit review instead of inventing payments, currencies, approvals or workspace ownership.

## 3. Rehearse the release and recovery point

- Restore an approved, appropriately protected representative backup into an isolated non-production environment, then run the exact missing migrations and application candidate. A second hosted environment has not been authorized; do not create or bill for one automatically.
- Verify a current managed recovery point and the actual restore procedure, duration, retention and access before the release window. A schema-only dump is not a recovery point. Supplemental logical backups must include needed application/private-schema data, policies, functions, grants and migration history; check Auth/roles separately. Standard Supabase dumps exclude managed schemas by default. Storage object metadata is not the stored file bytes: confirm a separate object recovery strategy and consistency with the database.
- Store backups only in approved protected storage, never the repo or test fixtures. Record checksums and timestamps without exposing credentials or personal data. A successful dump must be followed by a restore drill into an isolated target and data/schema comparisons.
- Local `npm run test:upgrade` covers a historical fourteen-table fixture and restore. `npm run test:upgrade:incremental` covers all 34 existing public/private tables from `fcddc0f` and the last three migrations. These passed, but are not evidence of a recoverable production backup.
- Validate hosted auth/email verification and expired sessions, intended origin/cookie behavior, PDF/CSV attachment delivery, private/no-store responses, receipt expiry, private-schema exclusion, RLS/grants, disabled-user behavior and provider configuration. Exercise live AI only with separately approved test credentials/traffic, or keep the feature disabled for rollout. Review current platform security advisories against the actual hosted database version.

## 4. Controlled cutover after explicit release authorization

1. Confirm all prior gates, the exact source/migration candidate, recovery point and release operator. Choose and rehearse an API/database maintenance or write-pause mechanism covering all clients. This mechanism is not implemented by this runbook. Do not assume a web banner freezes direct mobile/API writes.
2. Prevent automatic public promotion until the migration and smoke checks finish, or use an approved maintenance window with equivalent enforced protection. Because a push currently deploys, changing this release control is a separate authorized operation. Do not push first and race the database migration.
3. Take/verify the final recovery point, record the write-pause time and confirm no unsupported writers remain. Apply only the reviewed missing migrations, with stop-on-error and transaction boundaries validated in rehearsal. On failure, stop; never proceed to app promotion against a partial schema.
4. Verify schema/RPC availability, expected migration history, RLS/grants, unexposed `amountly_private`, historical totals/counts and absence of fabricated receipts or lost history. Validate that forbidden old direct writes still fail. Do not log individual records.
5. Deploy the exact candidate using the intended hosted environment, then run authenticated smoke checks before reopening writes. Do not promote a build whose public Supabase configuration points to local or staging services.
6. Restore normal access only after passing sign-in/onboarding, tenant denial, invoice draft/issue/partial receipt/correction, expense review, bill/PO commands, reports, PDF/CSV downloads and receipt expiry. Record deployment/schema versions and watch sanitized error rates. Confirm with the user which synthetic hosted QA records may be created; never mutate real financial records as smoke fixtures.

## Recovery decision table

| Situation | Response |
| --- | --- |
| Failure before migrations | Keep the prior application/database pair; stop the release. |
| A migration fails while writes are paused | Keep access paused. Inspect which transactions committed and compare history/catalog. Prefer a reviewed forward repair; otherwise use the rehearsed recovery process and matching old app. Do not rerun the full sequence blindly. |
| New app fails after successful migration, before writes reopen | Keep writes paused. Fix forward or deploy a version known to support the new schema. A Vercel-only rollback to the old direct-write app is incompatible. A full restore may be considered only after confirming no newer writes and verifying the recovery pair. |
| Failure after writes reopen | Pause affected writes, preserve the current database and audit trail, identify new receipts/orders/history since the recovery point, and prefer a forward fix. Restoring an earlier backup can discard valid financial activity and requires an explicit reconciliation/data-loss decision before execution. |

Do not drop the new ledger, history or receipt tables as a rollback shortcut. A DNS/alias/application rollback cannot undo a schema change. Reopening an older database also requires compatible Auth, Storage, client versions and environment configuration.

## Evidence required to mark the release ready

- Final candidate SHA and exact pending migration list reviewed.
- Active client inventory complete; incompatible iOS behavior addressed.
- Hosted historical-data checks and rehearsal complete.
- Recoverable production backup and enforced cutover/write gate verified.
- Hosted security/auth/provider settings verified.
- Local verification current for any final code changes; actual CSV/PDF downloads checked.
- Explicit production authorization, cutover owner and recovery decision recorded.

Until then, the safe deliverable is reviewed local code plus this plan, not a production push.

References: [Supabase SSR authentication](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [database backups](https://supabase.com/docs/guides/platform/backups), [Vercel deployment rollback](https://vercel.com/docs/instant-rollback). Verify the live platform and project configuration when executing the plan.
