# Authentication email through Resend

Release prepared October 19, 2026. The user authorized deployment of this focused email change. Verify activation against the exact Render deploy and controlled delivery results; the local file alone does not establish production state.

## Sending configuration

Signup verification, verification-code resends and password-reset codes all use `sendAuthCode` from `src/lib/platform/auth-email.ts`. Nodemailer submits to the fixed Resend SMTP endpoint `smtp.resend.com:587`, with mandatory STARTTLS, certificate verification and bounded timeouts. No new dependency was added. This follows [Resend's SMTP configuration](https://resend.com/docs/send-with-smtp).

Required server-only environment variables:

- `RESEND_FROM`: `security@auth.amountly.app` (plain email address; the display name is Amountly).
- `RESEND_API_KEY`: a sending-only Resend key restricted to the `auth.amountly.app` domain. Supply through Render's protected environment configuration; never put it in this document, source, logs, screenshots or a commit.

The old `SMTP_FROM`, `SMTP_USERNAME` and `SMTP_PASSWORD` are no longer read by this candidate. There is no automatic fallback to Proton. Keep the previous production configuration available for rollback until the new release is verified. The local Blueprint declares the new keys as `sync: false`; this does not populate them on an existing Render service or deploy the local changes.

Resend domain `auth.amountly.app` was created and verified in the live account. Sending is enabled; receiving, open tracking and click tracking are disabled. Vercel DNS contains the following provider-supplied records, verified by Resend and a readback from Vercel. Names below are relative to `amountly.app`; all existing DNS records were preserved.

| Type | Name | Value | Priority |
| --- | --- | --- | --- |
| TXT | `resend._domainkey.auth` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCwU9zNTqjlSU83vfPc6l+v3R8HuIR1nmwHAyRj5oq4690k1FC+CPXp+sIeD13fduuc/ExpYQ9XVLhl2u3RhkN3+YLfEilNLzfRlf31ZxaHde6JLwmRjoFS9tIu62mhJ/+QIrn9q2QXxV4AX6JUOUhpqfNKfE65a+G5YWKcTn1FmwIDAQAB` | — |
| MX | `send.auth` | `feedback-smtp.us-east-1.amazonses.com` | 10 |
| TXT | `send.auth` | `v=spf1 include:amazonses.com ~all` | — |
| CNAME | `rsend.auth` | `send.forge.rmta.net` | — |

The DKIM value is a public DNS verification key, not a private signing key. A dedicated sending-only key restricted to this domain was created and transferred directly into Render's protected `RESEND_API_KEY` setting without displaying or committing the token. `RESEND_FROM` was set to the address above. All other production variables, including the previous SMTP configuration for rollback, were preserved.

## Preserved behavior and verification

Codes remain six digits, expire after ten minutes and are stored hashed. Existing verification requirements, rate limits, account boundaries, single-use codes and password-reset session revocation remain in place. Invalid mail input is rejected before opening SMTP, and SMTP errors are replaced with a generic error without provider diagnostics.

`npm run test:auth` includes the new mail tests. They verify the actual auth routes with Better Auth's in-memory adapter and an in-process SMTP replacement: signup, resend, unverified-account denial, verification, hashed codes, password reset, reset-code replay denial, session revocation and old-password rejection. No real email is sent. Additional checks cover the Resend endpoint, mandatory TLS, missing configuration, header injection, invalid codes and safe transport failure handling.

Local validation passed: 11 auth tests, 10 OAuth tests, three existing browser-auth state tests, TypeScript lint, and `npm run build -- --webpack`. The updated environment declarations also match Render's current Blueprint schema. The PostgreSQL-backed auth rehearsal was updated for the new environment names but was not run because its isolated rehearsal database is not present on this host; the new in-memory test exercises the real route/provider code without a database connection.

Release verification: deploy only the reviewed change, then run controlled live signup and password-reset tests to an explicitly approved recipient. Check actual receipt and placement; domain verification alone does not establish inbox delivery. Do not use a customer password-reset request as a smoke test.
