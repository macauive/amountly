# Release inspection

`release-catalog-check.sql` is a read-only catalog inventory for the workflow release. It reports PostgreSQL version, expected columns, table RLS/grants, function execution grants and trigger state. It does not select financial records, user identities, credentials, policy expressions or function bodies.

Run only against an explicitly approved target, using a dedicated connection and credentials supplied through the approved local connection mechanism. For example, after configuring a protected PostgreSQL service entry:

```sh
PGSERVICE=amountly-approved-readonly psql -X -v ON_ERROR_STOP=1 -f ops/release-catalog-check.sql
```

The service name is an example, not a configured or verified destination. Confirm the target separately. The SQL opens a repeatable-read, read-only transaction, sets short statement/lock/idle timeouts, and ends with rollback. A connection or permission failure means inspection is incomplete, not that the database passed. Keep any output in approved protected storage outside Git.

Missing workflow objects are expected before migration. Compare them with migration history and the candidate; do not use this report to automatically apply SQL or repair history. RLS enabled and function execution granted are not proof of correct authorization. Policy bodies, trigger logic, column-level privileges, API schema exposure, role tests, representative historical data and recovery checks still require review. This script does not implement a maintenance/write gate.

## Local validation, September 26, 2026

Validated against the isolated local Supabase stack after commit `a81c673`. The transaction reports read-only mode and all ten expected columns exist. Public application tables have RLS enabled. Two private internal tables (`invoice_counters` and `time_invoice_requests`) do not have RLS; neither `anon` nor `authenticated` has direct SELECT/INSERT/UPDATE/DELETE access. This is an inventory observation, not a claim about production exposure. Existing authorization and upgrade/restore tests passed separately.

The CLI reported local Auth, Storage and REST service versions differ from its cached linked-project versions. This reinforces the need for hosted verification; that warning is not a current production inventory.

## Outstanding production inspection

- Confirm iOS/App Store/TestFlight and other active clients with the owner.
- Inspect actual deployment revision, production branch/automatic promotion and environment configuration without reading secret values into output.
- Compare hosted migration history and live catalog against the candidate's exact SQL files; check the historical `organizations.owner_id` prerequisite.
- Inspect actual backup/recovery availability, historical data anomalies and the intended cutover/write gate.
- Review the September 25 [Supabase PostgreSQL update advisory](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes) against the actual hosted server, extensions and indexes. Source inspection alone cannot establish whether a hosted-only object is affected.

## Hosted inspection, September 26, 2026

The user subsequently authorized pushing the tested web release. Necessary read-only production inspection and a migration dry run were performed; no migration, production setting change or Git push was performed.

- Vercel confirms Amountly's production deployment is Ready and uses Node 24.x. The local branch is seven commits ahead of the freshly fetched remote branch; this does not identify the deployed commit because deployments can be made independently of Git pushes.
- Production migration history and `supabase db push --linked --dry-run` agree that all eleven timestamped workflow migrations are pending. No migration-history repair or historical replay is needed according to this dry run.
- Direct catalog checks confirm `organizations.owner_id` already exists, but workspaces, invoice payments, the private capture ledger and the purchase-order command API are absent. Deploying candidate `a81c673` before the required database upgrade would create a schema mismatch.
- All public application tables have RLS enabled. The security advisor reports leaked-password protection disabled and privileged-function execution grants needing review. Three anonymously executable functions return trigger/event-trigger types; this warning alone does not demonstrate a callable data-leak endpoint. The fourth, `get_user_organization_id`, selects only the organization matching `auth.uid()`. Quota-table RLS without policies is intentional deny-by-default behavior. These observations do not certify all hosted authorization paths.
- PostgreSQL reports 17.6. Actual backup/recovery availability, historical-data checks, active iOS distribution and controlled cutover remain unverified. No production smoke records have been created.

## Recovery rehearsal and candidate correction

The user confirmed the iOS client is only used for their own development/testing and authorized completing verification and pushing the web release. The backup API returned no available backups and PITR disabled. A logical roles/schema/data backup was therefore saved outside the repository with owner-only permissions, covering public, Auth, Storage and migration-history schemas. Storage had zero objects. This is a protected logical recovery point, not managed PITR.

The backup restored successfully in a network-isolated PostgreSQL 17 container. The first migration rehearsal found two legacy organizations with deleted Auth owners. The pending workspace migration was corrected to leave only those new workspace owners null while preserving the original organization values. All eleven migrations then succeeded, and all original column values across 61 existing tables matched the pre-upgrade snapshot. Checksums and detailed restore evidence remain in protected local storage.

The added regression test and all 42 unit tests, TypeScript, fresh security checks and both synthetic upgrade/restore suites pass. Existing production bundles reference the verified Supabase project; Vercel CLI environment exports redact values, so a redacted export is not evidence of a different backend. Production deployment and post-cutover smoke tests must be recorded after execution.

Advisor references: [privileged anonymous execution](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [privileged authenticated execution](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

See [the release runbook](../docs/release-runbook.md). PostgreSQL documents the transaction guarantees in [SET TRANSACTION](https://www.postgresql.org/docs/current/sql-set-transaction.html).
