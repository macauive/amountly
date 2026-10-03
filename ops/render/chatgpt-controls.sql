create table if not exists amountly_auth.mcp_rate (
  key text primary key check(length(key)<=100), window_start timestamptz not null, count integer not null check(count>0)
);
create table if not exists amountly_auth.mcp_grants (
  authorization_code_id text primary key check(length(authorization_code_id)=64),
  user_id uuid not null references amountly_auth."user"(id) on delete cascade,
  granted_at timestamptz not null default now(), revoked_at timestamptz
);
create index if not exists mcp_grants_user_idx on amountly_auth.mcp_grants(user_id);
create table if not exists amountly_auth.mcp_audit (
  id uuid primary key default pg_catalog.gen_random_uuid(), user_id uuid not null,
  tool text not null check(tool in ('get_financial_review','list_unpaid_invoices','list_upcoming_bills','summarize_expenses','get_financial_record')),
  outcome text not null check(outcome in ('success','error')), created_at timestamptz not null default now()
);
create index if not exists mcp_audit_created_idx on amountly_auth.mcp_audit(created_at);
create table if not exists amountly_auth.deletion_requests (
  user_id uuid primary key references amountly_auth."user"(id) on delete cascade,
  requested_at timestamptz not null default now(), status text not null default 'pending' check(status in ('pending','completed'))
);
revoke all on all tables in schema amountly_auth from public, anon, authenticated, amountly_data_runtime;
grant usage on schema amountly_auth to amountly_auth_runtime;
grant select, insert, update, delete on all tables in schema amountly_auth to amountly_auth_runtime;
grant usage, select on all sequences in schema amountly_auth to amountly_auth_runtime;
-- Remove idle per-user rate counters without storing request arguments or
-- results. Run via the existing maintenance process; counters also self-reset.
delete from amountly_auth.mcp_rate where window_start < now()-interval '1 day';
delete from amountly_auth.mcp_audit where created_at < now()-interval '30 days';
