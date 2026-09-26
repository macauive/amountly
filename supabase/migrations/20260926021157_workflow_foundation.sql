-- Preserve legacy records. Tighten future writes without rewriting history.
create schema if not exists amountly_private;
revoke all on schema amountly_private from public, anon;
grant usage on schema amountly_private to authenticated;

-- Private lookup avoids recursive users RLS and never trusts user_metadata.
create function amountly_private.active_actor() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.users where id = auth.uid() and is_active is true)
$$;
revoke all on function amountly_private.active_actor() from public, anon;
grant execute on function amountly_private.active_actor() to authenticated;

create function amountly_private.onboarding_actor() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and not exists (
    select 1 from public.users where id = auth.uid() and is_active is not true
  )
$$;
revoke all on function amountly_private.onboarding_actor() from public, anon;
grant execute on function amountly_private.onboarding_actor() to authenticated;

do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname = 'public'
    and tablename not in ('users', 'organizations') loop
    execute format('create policy "Active account required" on public.%I as restrictive for all to authenticated using ((select amountly_private.active_actor())) with check ((select amountly_private.active_actor()))', t.tablename);
  end loop;
end $$;
-- A disabled user can read only their own profile so the app can explain access.
create policy "Active profile read" on public.users as restrictive for select to authenticated
using (id = auth.uid() or (select amountly_private.active_actor()));
create policy "Active profile insert" on public.users as restrictive for insert to authenticated
with check ((select amountly_private.onboarding_actor()));
create policy "Active profile update" on public.users as restrictive for update to authenticated
using ((select amountly_private.active_actor())) with check ((select amountly_private.active_actor()));
create policy "Active profile delete" on public.users as restrictive for delete to authenticated
using ((select amountly_private.active_actor()));
create policy "Active organization access" on public.organizations as restrictive for all to authenticated
using ((select amountly_private.onboarding_actor())) with check ((select amountly_private.onboarding_actor()));
create policy "Active receipt access" on storage.objects as restrictive for all to authenticated
using (bucket_id <> 'receipts' or (select amountly_private.active_actor()))
with check (bucket_id <> 'receipts' or (select amountly_private.active_actor()));

create function amountly_private.protect_org_owner() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' and new.owner_id is distinct from old.owner_id then
    raise exception 'Ownership transfer requires a dedicated administrative operation' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger protect_org_owner before update on public.organizations
for each row execute function amountly_private.protect_org_owner();

-- Stable organization/user boundaries on parent records.
create function amountly_private.protect_workspace_parent() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.organization_id is distinct from old.organization_id
      or new.user_id is distinct from old.user_id) then
    raise exception 'Record workspace cannot be changed' using errcode = '42501';
  end if;
  if tg_table_name = 'projects' then
   if new.client_id is not null then
    if not exists (select 1 from public.clients c where c.id = new.client_id
      and c.organization_id is not distinct from new.organization_id
      and c.user_id is not distinct from new.user_id) then
      raise exception 'Client must belong to this workspace' using errcode = '42501';
    end if;
  end if;
  end if;
  return new;
end $$;
create trigger protect_client_workspace before update on public.clients
for each row execute function amountly_private.protect_workspace_parent();
create trigger protect_project_workspace before insert or update on public.projects
for each row execute function amountly_private.protect_workspace_parent();

create function amountly_private.protect_work_record() returns trigger
language plpgsql security definer set search_path = '' as $$
declare owner_profile public.users; actor public.users; old_state text; new_state text;
begin
  select * into owner_profile from public.users where id = new.user_id;
  select * into actor from public.users where id = auth.uid() and is_active is true;
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'Record owner cannot be changed' using errcode = '42501';
  end if;
  if new.project_id is not null and not exists (
    select 1 from public.projects p where p.id = new.project_id and (
      (owner_profile.organization_id is not null and p.organization_id = owner_profile.organization_id and p.user_id is null)
      or (owner_profile.organization_id is null and p.organization_id is null and p.user_id = new.user_id)
    )
  ) then raise exception 'Project must belong to this workspace' using errcode = '42501'; end if;
  if new.task_id is not null and not exists (
    select 1 from public.tasks t where t.id = new.task_id and t.project_id = new.project_id
  ) then raise exception 'Task must belong to the selected project' using errcode = '42501'; end if;
  if new.invoice_id is not null and not exists (
    select 1 from public.invoices i where i.id = new.invoice_id and (
      (owner_profile.organization_id is not null and i.organization_id = owner_profile.organization_id and i.user_id is null)
      or (owner_profile.organization_id is null and i.organization_id is null and i.user_id = new.user_id)
    )
  ) then raise exception 'Invoice must belong to this workspace' using errcode = '42501'; end if;
  -- The JWT role is issued by Auth, not editable user metadata.
  if auth.jwt()->>'role' = 'authenticated' then
    if actor.id is null then raise exception 'Active account required' using errcode = '42501'; end if;
    new_state := coalesce(new.status::text, '');
    if tg_op = 'UPDATE' then old_state := old.status::text; end if;
    if new_state not in ('DRAFT','SUBMITTED') or coalesce(old_state,'DRAFT') not in ('DRAFT','SUBMITTED') then
      if actor.organization_id is null or actor.organization_id is distinct from owner_profile.organization_id
        or actor.role not in ('OWNER','ADMIN') or actor.id = new.user_id then
        raise exception 'Independent workspace approval is required' using errcode = '42501';
      end if;
      if tg_op = 'INSERT' or old_state not in ('SUBMITTED','APPROVED')
        or (old_state = 'SUBMITTED' and new_state not in ('APPROVED','REJECTED'))
        or (old_state = 'APPROVED' and new_state not in ('REIMBURSED'))
        or (to_jsonb(new) - array['status','updated_at']) is distinct from (to_jsonb(old) - array['status','updated_at']) then
        raise exception 'Invalid approval transition' using errcode = '42501';
      end if;
    end if;
    if (tg_op = 'INSERT' and new.invoice_id is not null)
      or (tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id) then
      raise exception 'Invoice linkage requires the billing workflow' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function amountly_private.protect_work_record() from public, anon, authenticated;
create trigger protect_expense_workflow before insert or update on public.expenses
for each row execute function amountly_private.protect_work_record();
create trigger protect_time_workflow before insert or update on public.time_entries
for each row execute function amountly_private.protect_work_record();

-- NOT VALID preserves historical anomalies for review, while checking new writes.
alter table public.expenses add constraint expense_positive_amount check (amount > 0 and amount < 100000000) not valid;
alter table public.time_entries add constraint time_valid_duration check (duration_minutes > 0 and end_at > start_at and (billable_rate is null or billable_rate >= 0)) not valid;

-- Deleting a contact or project must never silently delete accounting evidence.
alter table public.invoices drop constraint invoices_client_id_fkey;
alter table public.invoices add constraint invoices_client_id_fkey foreign key (client_id) references public.clients(id) on delete restrict;
alter table public.time_entries drop constraint time_entries_project_id_fkey;
alter table public.time_entries add constraint time_entries_project_id_fkey foreign key (project_id) references public.projects(id) on delete restrict;
alter table public.clients add column archived_at timestamptz;
alter table public.projects add column archived_at timestamptz;

-- Store object names, not expiring bearer URLs. Existing references are left
-- untouched until the app validates their host/bucket and refreshes on access.
alter table public.expenses add column receipt_path text;

create function amountly_private.protect_reviewed_record() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' and old.status::text not in ('DRAFT','REJECTED') then
    raise exception 'Submitted and approved records must be preserved' using errcode='42501';
  end if;
  return old;
end $$;
create trigger preserve_reviewed_expense before delete on public.expenses
for each row execute function amountly_private.protect_reviewed_record();
create trigger preserve_reviewed_time before delete on public.time_entries
for each row execute function amountly_private.protect_reviewed_record();

create function amountly_private.protect_receipt_reference() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if new.receipt_path is not null and (new.receipt_path not like new.user_id::text || '/%'
      or new.receipt_path like '%..%' or new.receipt_path like '%\\%') then
      raise exception 'Invalid receipt object path' using errcode='42501';
    end if;
    if new.receipt_url is not null and (tg_op='INSERT' or new.receipt_url is distinct from old.receipt_url) then
      raise exception 'Use a receipt object path instead of a signed link' using errcode='22023';
    end if;
  end if;
  return new;
end $$;
create trigger protect_receipt_reference before insert or update on public.expenses
for each row execute function amountly_private.protect_receipt_reference();

create function amountly_private.protect_disabled_profile() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if auth.jwt()->>'role' = 'authenticated' and old.is_active is not true then
    raise exception 'Active account required' using errcode='42501';
  end if;
  return new;
end $$;
create trigger protect_disabled_profile before update on public.users
for each row execute function amountly_private.protect_disabled_profile();

create function amountly_private.protect_expense_lines() returns trigger
language plpgsql security invoker set search_path='' as $$
declare parent public.expenses; parent_id uuid;
begin
  if current_user = 'authenticated' then
    if tg_op='DELETE' then parent_id := old.expense_id; else parent_id := new.expense_id; end if;
    if tg_op='UPDATE' and new.expense_id is distinct from old.expense_id then
      raise exception 'Expense line parent cannot be changed' using errcode='42501';
    end if;
    select * into parent from public.expenses where id=parent_id for update;
    if parent.id is null or parent.status::text not in ('DRAFT','REJECTED') then
      raise exception 'Only draft expense lines may be changed' using errcode='42501';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger protect_expense_lines before insert or update or delete on public.expense_line_items
for each row execute function amountly_private.protect_expense_lines();

-- Trigger routines are not a public API. Explicit helper grants above remain.
revoke all on all functions in schema amountly_private from public, anon;
