-- Empty target only. Auth UUID anchors preserve existing application foreign keys.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
  if not exists(select 1 from pg_roles where rolname='amountly_auth_runtime') then create role amountly_auth_runtime login noinherit; end if;
  if not exists(select 1 from pg_roles where rolname='amountly_data_runtime') then create role amountly_data_runtime login noinherit; end if;
end $$;
create schema auth;
create schema amountly_auth;
create schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create table auth.users(id uuid primary key);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
grant usage on schema auth, extensions to authenticated;
revoke all on auth.users from public, anon, authenticated;
revoke create on schema public from public;
