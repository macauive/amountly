-- Apply as the migration owner before deploying the auth route.
create table if not exists amountly_auth.otp_limits (
  email_key text not null,
  operation text not null,
  used integer not null check (used > 0),
  expires_at timestamptz not null,
  next_at timestamptz not null,
  primary key (email_key, operation)
);
create index if not exists otp_limits_expiry_idx on amountly_auth.otp_limits (expires_at);
revoke all on amountly_auth.otp_limits from public;
grant select, insert, update, delete on amountly_auth.otp_limits to amountly_auth_runtime;
