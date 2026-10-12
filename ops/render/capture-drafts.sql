-- Additive Render migration. Apply only to the intended database during a separately
-- authorized release. Capture proposals never create financial rows or public files.
begin;
create schema if not exists amountly_files;
revoke all on schema amountly_files from public;
grant usage on schema amountly_files to authenticated;
create table if not exists amountly_files.capture_drafts (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  revision integer not null default 1 check (revision > 0),
  payload jsonb not null check (octet_length(payload::text) <= 65536),
  file_name text check (length(file_name) between 1 and 200),
  content_type text check (content_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  contents bytea check (octet_length(contents) between 1 and 10485760),
  file_sha256 text,
  updated_at timestamptz not null default now(),
  check ((contents is null and file_name is null and content_type is null and file_sha256 is null)
    or (contents is not null and file_name is not null and content_type is not null and file_sha256 ~ '^[a-f0-9]{64}$'))
);
alter table amountly_files.capture_drafts enable row level security;
grant select, insert, update, delete on amountly_files.capture_drafts to authenticated;
drop policy if exists "Own private captures" on amountly_files.capture_drafts;
create policy "Own private captures" on amountly_files.capture_drafts to authenticated
using (owner_id = auth.uid() and exists(select 1 from public.users where id=auth.uid() and is_active))
with check (owner_id = auth.uid() and exists(select 1 from public.users where id=auth.uid() and is_active));
create index if not exists capture_drafts_owner on amountly_files.capture_drafts(owner_id);
commit;
