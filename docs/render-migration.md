# Full Render migration

Updated October 2, 2026. The user authorized moving Amountly web, database,
authentication and receipts off hosted Vercel/Supabase to Render. Production
now runs on Render at `https://amountly.app`, including the final database,
authentication and private receipt storage. Both custom domains have valid TLS. Deployment branch: `codex/render-hosting`, baseline `1609b6a`.

## Implemented architecture

- One Docker web service runs Next.js on Node 24 and PostgREST 16.4. PostgREST
  and its readiness endpoint bind only to loopback. Only Next.js is public.
- Better Auth stores credentials, verification challenges and sessions in the
  private `amountly_auth` schema. Cookies are HttpOnly, Secure in production,
  and SameSite=Lax. Session tokens are removed from browser JSON responses.
- Separate auth and data runtime roles do not own application tables, inherit
  privileges, or bypass RLS. Server-validated sessions supply short-lived
  PostgREST identities. Caller-supplied identity and schema headers are ignored.
- Existing SQL procedures, financial transactions, UUIDs, audit history and RLS
  remain intact. API routes constrain tables/RPCs, payloads and response sizes.
- Receipt bytes live in private PostgreSQL storage, with owner policies, generated
  paths, MIME signature checks and a 10 MB limit. No persistent disk is needed.
- Proton SMTP submission uses `info@macdigital.ai`, mandatory STARTTLS and a
  dedicated token. Sign-up verification and password reset require working SMTP;
  verification is never disabled to bypass a mail configuration failure.
- `NEXT_PUBLIC_BACKEND=render` selects this stack at build time. Legacy Supabase
  code is retained for the existing deployment and rollback. The Docker build
  excludes local environment files and uses no hosted Supabase credentials.
- `GET /api/health` checks the auth schema and PostgREST readiness in Render mode;
  it returns only generic status with no-store headers.

## Protected backup and rehearsal evidence

Protected local storage outside Git contains a PostgreSQL 17 custom-format
backup of application/private schemas, Auth, Storage and migration history.
Directory permissions are owner-only. Never attach this backup to an issue or PR.

The backup restored into isolated local databases. All 36 application/private
tables matched by row count and canonical row digest. Nine account IDs and
bcrypt password hashes were imported and compared without printing their values.
No sessions were copied: existing users must sign in again after cutover.
Verified email, banned and disabled status are preserved. Unsupported providers,
MFA factors, or password formats make the importer fail closed.

Both the rehearsal and final frozen source inventories contained no Storage
objects; there were no existing receipt files to transfer.

## Verification completed

- Existing 77 unit tests and 11 PostgreSQL security test groups pass.
- Node 24 typecheck and Next.js production build pass, including the Docker build.
- The production Docker container starts and its readiness endpoint returns 200.
- Actual HTTP tests against that container pass for imported bcrypt sign-in,
  Secure/HttpOnly cookies, withheld session tokens, account/RLS isolation,
  forbidden schema/RPC access, CSRF, role escalation denial, receipt ownership,
  account disablement and immediate session revocation.
- A separate local suite passes sign-up verification, hashed/single-use OTP,
  unverified account denial, password reset, session revocation and rejection of
  the old password. Its SMTP transport is replaced in-process: no real mail sent.
- In-app browser QA sign-in, dashboard, invoices and invoice PDF download work
  against the restored local database using the original QA password.
- Next.js was patched to the locked 16.3.8 release. The remaining npm audit
  findings are development Tailwind dependencies requiring a separate major
  upgrade; they are not silently treated as resolved.

## Render deployment and cutover record

The final database is `amountly_db` on the approved PostgreSQL 17 instance in
Ohio: 0.1 CPU, 256 MB RAM, 5 GB storage, autoscaling off, $7.50/month base cost.
The temporary import IP rule was removed. A real external PostgreSQL connection
is denied, while the deployed app remains healthy through the private network.
[Database dashboard](https://dashboard.render.com/d/dpg-db05n4vavr4c73e8nq60-a/info).

The Docker web service is live on one 0.5 CPU / 512 MB instance at $7/month,
with manual deploys, no disk and protected runtime-role credentials. It uses
`amountly_db`, verified by creating a QA session through the live API and checking
that the session exists in the final database. Owner credentials are not deployed.
[Service dashboard](https://dashboard.render.com/web/srv-db0717id0e5s73ac6lig).
Deployed application commit: `d46cb57` on `codex/render-hosting`.

The user also resized Drop It to $7/month. Including both PostgreSQL databases,
the configured workspace base total is $29/month before usage and taxes.
Resizing compute later remains possible; storage autoscaling is disabled.

The final cutover backup includes application/private schemas, Auth, Storage,
migration history, and the reversible source write-pause mechanism. It is stored
outside Git with owner-only permissions and SHA-256 checksums. The frozen source
was restored locally before importing the final Render database. Exact comparison
passed for all 36 tables and 91 rows, nine account IDs/password hashes/statuses,
and 133 existing access policies. There were zero stored receipt objects.

Source writes are paused on 41 tables across application, private, account,
identity, MFA and storage paths. Statement triggers reject all mutations, including
zero-row updates and direct-client writes. The protected backup directory contains
an explicit transactional undo script. The old Vercel/Supabase deployment and the
isolated Render candidate are retained for recovery; nothing was cancelled or
purged. Existing sessions were not imported, so users must sign in again.

Proton SMTP authentication and certificate-verified STARTTLS succeeded from the
live Render container using its protected deployment credentials. No real email
was sent; delivery/inbox verification still needs an explicitly authorized test.

Live HTTP checks pass for health, imported QA sign-in, Secure/HttpOnly cookies,
withheld session tokens, account-scoped records, blocked private schema access,
invoice PDF download and immediate session revocation.

DNS is managed by Vercel. The apex A record now targets Render's documented
`216.24.57.1`; `www` is a CNAME to `amountly.onrender.com` and redirects to the apex.
Both domains are verified and serve valid HTTPS. The `www` HTTPS redirect to the
apex works. In-app browser QA sign-in, dashboard and invoices load at the live
domain. Live-domain HTTP checks also pass for health, sign-in, protected records,
PDF export, cookie security and session revocation.
The pre-cutover DNS state and new record IDs are saved with the protected backup.

Before any rollback, stop new Render writes and preserve/reconcile them. Changing
DNS back alone can lose valid financial activity. Restore source writes only after
reconciliation and a deliberate rollback decision.

## Separate client and ChatGPT work

The development iOS client still uses Supabase interfaces and needs a compatible
cookie/API update before using the Render backend. The current web branch has no
MCP endpoint or ChatGPT OAuth integration. Those are separate follow-on tasks
using the same account-scoped backend, not completed by this infrastructure move.

## References

- [Render Docker services](https://render.com/docs/docker)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
- [Better Auth Supabase migration](https://better-auth.com/docs/guides/supabase-migration-guide)
- [Better Auth Next.js integration](https://better-auth.com/docs/integrations/next)
- [PostgREST readiness](https://docs.postgrest.org/en/v16/references/admin_server.html)
- [Proton SMTP submission](https://proton.me/support/smtp-submission)
