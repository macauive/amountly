# Full Render migration

Updated October 2, 2026. The user authorized moving Amountly web, database,
authentication and receipts off hosted Vercel/Supabase to Render. Production
has not switched. Preparation branch: `codex/render-hosting`, baseline `1609b6a`.

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

The source inventory contained no Storage objects. Recheck this at the final
write pause; any new objects must be migrated before cutover.

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

## Render resources and remaining deployment steps

The approved `amountly-db` PostgreSQL 17 instance is Available in Ohio:
0.1 CPU, 256 MB RAM, 5 GB storage, autoscaling off, $7.50/month base cost.
The user approved a temporary current-IP-only import rule, which is active.
Remove it immediately after migration. The isolated `amountly_candidate` database
now has all 36 application tables and nine accounts; row digests and password
hashes match the protected source snapshot. The production database is still empty.
[Database dashboard](https://dashboard.render.com/d/dpg-db05n4vavr4c73e8nq60-a/info).

`ops/render-app.yaml` defines the full Docker app: Ohio, one 0.5 CPU / 512 MB instance,
manual deploys, no disk, and protected environment variables. Proposed web cost
is $7/month, approved by the user, for an Amountly subtotal of $14.50/month.
The user also resized Drop It to $7/month. Including both databases, the
workspace base total will be $29/month
before usage. The web resource has not yet been submitted.

The Proton token is saved in owner-only local storage outside Git. SMTP
authentication and certificate-verified STARTTLS succeeded for the configured
sender. No real email has been sent and the token has not yet been deployed.

Before source production mutation or domain cutover:

1. Review and push the tested migration branch. Prepare Render Docker service
   secrets using private runtime-role URLs; never deploy the database owner URL.
2. Import and validate an isolated Render candidate. Use `bootstrap.sql`, restore
   application/private schemas and auth UUID anchors, run `import-auth.ts`, then
   `configure-roles.mjs`. The role script requires a new owner-only destination
   outside Git and persists credentials before transactional role changes.
3. Verify the Render candidate's login, financial read/write boundaries, exports,
   receipts, health and Proton SMTP connection. Real test email needs explicit
   recipient authorization. Keep candidate writes isolated from live data.
4. Pause source writes across public/private application, auth and storage paths,
   including direct clients. Take a fresh final backup, repeat import, compare all
   data and identity state, migrate any new receipt objects, then switch the
   verified custom domain. A web-only maintenance banner is insufficient.
5. Remove temporary external DB access and verify HTTPS, cookies, SMTP delivery,
   log-in, records and exports at `amountly.app`. Preserve the source recovery pair
   until rollback is no longer needed. Do not delete or cancel old platforms.

If Render has accepted user writes, preserve and reconcile them before rollback;
changing DNS back by itself can lose valid financial activity.

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
