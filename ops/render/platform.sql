-- Run as the migration owner AFTER restoring application schemas and generating
-- Better Auth tables in amountly_auth. Runtime roles never own public tables.
create schema if not exists amountly_files;
revoke all on schema amountly_auth, amountly_files from public;
grant usage on schema amountly_auth to amountly_auth_runtime;
grant select, insert, update, delete on all tables in schema amountly_auth to amountly_auth_runtime;
grant usage, select on all sequences in schema amountly_auth to amountly_auth_runtime;
alter default privileges in schema amountly_auth grant select, insert, update, delete on tables to amountly_auth_runtime;
grant usage on schema public, auth to amountly_auth_runtime;
grant select (id, is_active) on public.users to amountly_auth_runtime;
create policy "Auth checks account status" on public.users for select to amountly_auth_runtime using (true);

-- Retain stable UUID anchors for existing application FKs. Auth credentials and
-- sessions live exclusively in the private Better Auth schema.
create function amountly_auth.anchor_user() returns trigger language plpgsql security definer
set search_path = '' as $$ begin
  insert into auth.users(id) values (new.id::uuid) on conflict (id) do nothing;
  return new;
end $$;
revoke all on function amountly_auth.anchor_user() from public;
create trigger anchor_user after insert on amountly_auth."user" for each row execute function amountly_auth.anchor_user();

create table amountly_files.receipts (
  path text primary key check (length(path) <= 100),
  owner_id uuid not null references auth.users(id),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  contents bytea not null check (octet_length(contents) between 1 and 10485760),
  created_at timestamptz not null default now()
);
alter table amountly_files.receipts enable row level security;
grant usage on schema amountly_files to authenticated;
grant select, insert on amountly_files.receipts to authenticated;
create policy "Receipt owner read" on amountly_files.receipts for select to authenticated
using (owner_id = auth.uid() and exists(select 1 from public.users where id=auth.uid() and is_active));
create policy "Receipt owner insert" on amountly_files.receipts for insert to authenticated
with check (owner_id = auth.uid() and split_part(path,'/',1)=auth.uid()::text
  and exists(select 1 from public.users where id=auth.uid() and is_active));

grant authenticated to amountly_data_runtime;
grant usage on schema public, auth to authenticated;
-- PostgREST's authenticator cannot access records before SET ROLE authenticated.
revoke all on schema public, auth, amountly_files from amountly_data_runtime;
revoke create on schema public from public;
alter role amountly_data_runtime set statement_timeout = '15s';
alter role amountly_auth_runtime set statement_timeout = '10s';
