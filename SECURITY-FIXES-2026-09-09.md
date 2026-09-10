# Amountly security fixes — September 9, 2026

Implemented and verified locally. No production deployment or production database migration was performed.

## Fixed

- Updated dependencies and lockfile, including Next.js 16.3.4, Supabase SSR 0.12.7, Supabase JS 2.116.0, and vulnerable transitive dependencies. Final `npm audit --json` reports zero vulnerabilities across the full dependency tree. The application now declares Node.js 22 or newer, as required by the updated Supabase client.
- AI requests require a bearer token verified by Supabase Auth and an active application profile. Cross-origin browser requests are rejected. Cookies alone cannot invoke the paid endpoint.
- Added a database-backed quota of 10 requests per UTC minute and 100 per UTC day per user. The endpoint refuses requests if quota enforcement is unavailable. Counts include admitted requests that subsequently fail at the provider. These limits bound per-user usage, not total spend across newly created accounts; retain provider-level budget controls.
- Limited request bytes, allowed task names and task-specific fields, output sizes, financial numbers, dates, and internal navigation destinations. Dashboard requests now omit signed receipt links, ownership identifiers, and unrelated nested records. Redaction remains a partial privacy filter, not a guarantee that all personal data is removed.
- Added provider timeout/output limits, disabled Responses API application-state storage with `store: false`, and removed provider/configuration details from error responses. This setting is not a claim of zero provider retention.
- Fixed raw Responses API output parsing, including safe handling of refusals and incomplete responses.
- Added restrictive database role policies for invoices, invoice lines, clients, projects, and tasks. Lower-privilege members cannot manage financial records through direct API requests. Contractors can create draft invoices and send them, but cannot edit arbitrary headers, mark paid, delete invoices, or change lines after sending. Invoice references must stay inside their workspace, and ownership is immutable. Metrics RPCs now respect the caller's RLS policies.
- Both CSV export paths use a shared encoder that neutralizes formula-leading strings while preserving real numeric cells.
- Added baseline CSP restrictions for framing, objects, forms and base URLs, plus frame denial, MIME sniffing protection, referrer and permissions headers. This is not a full nonce-based script CSP.
- Debounced dashboard AI requests and removed the obsolete custom Supabase refresh-lock override after upgrading its authentication library.

## Verification

- `npm run lint`: passed.
- `npm run build`: passed on Next.js 16.3.4.
- `npm run test:security`: nine passing tests covering authentication, input/body limits, quota failures, response parsing, output validation, data minimization, and CSV injection.
- `npm run test:security:db`: passed in a disposable PostgreSQL 16 cluster using synthetic fixtures and a private Unix socket. Tested role permissions, tenant boundaries, invoice relations, aggregate RPC access, contractor transitions, counter permissions, daily rollover, and 24 concurrent requests admitting exactly 10. The cluster is removed after the run; no external database connection is accepted by the test runner.
- In-app browser: homepage and login rendered; navigation worked; signed-out dashboard redirected to login; no warnings/errors appeared during those checks.
- Local production HTTP checks: login returned 200 with all five configured security headers; unauthenticated `POST /api/ai` returned 401 with a generic sign-in message and `Cache-Control: no-store`.
- Final dependency audit: zero critical, high, moderate, low, or informational findings. This is the registry's current advisory result, not proof that no unknown vulnerabilities exist.

## Release requirements

1. Use Node.js 22 or newer and install from the updated lockfile.
2. Confirm the target database has migrations through 019 and review its current grants/policies. Apply **020_ai_quota.sql** and **021_financial_role_permissions.sql** through the project's normal migration process before deploying the application change. These migrations add policy/function/table definitions; they do not rewrite financial records.
3. Deploy the application and rerun authenticated QA against the actual environment: valid AI request, role-restricted access, CSV exports, and quota behavior. The earlier live sign-in attempt failed due to DNS resolution, and production authentication/provider traffic was not retested by these local checks.
4. Verify the installed policies rather than assuming source migrations equal deployed state. Keep migration 020 in place if the application needs a rollback; reverting to the old public AI route would reopen the vulnerability.

If migration 020 is absent, AI returns a generic unavailable response instead of bypassing quotas. Existing clients without the new bearer header receive 401 and should reload after deployment. Existing organizations using member/contractor access will see the newly enforced role restrictions.

The database test setup supplies one historical prerequisite: migration 011 assumes `organizations.owner_id` exists, while migration 019 later explicitly ensures that column. This does not change production history; avoid replaying the old migration chain blindly against a new environment.

## Separate functional findings still open

This pass addresses the security vulnerabilities. The earlier review's invoice edit/numbering/atomicity bugs, expiring durable receipt references, tax-calendar deadline, deferred accounting posting, password recovery, and broader mobile/product improvements remain separate work. No production financial records were corrected or backfilled.
