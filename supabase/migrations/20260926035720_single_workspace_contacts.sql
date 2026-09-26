-- One membership per user. Existing organization IDs and individual user IDs
-- remain stable workspace identities; financial rows are not moved or merged.
create table public.workspaces (
  id uuid primary key,
  organization_id uuid unique references public.organizations(id) on delete restrict,
  owner_id uuid references auth.users(id) on delete restrict,
  kind text not null check(kind in ('individual','business')),
  created_at timestamptz not null default now(),
  check((kind='business')=(organization_id is not null))
);
create table public.workspace_memberships (
  user_id uuid primary key references public.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  role text not null check(role in ('OWNER','ADMIN','MEMBER','CONTRACTOR')),
  is_active boolean not null,
  created_at timestamptz not null default now()
);
create index workspace_memberships_workspace on public.workspace_memberships(workspace_id);
alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
revoke all on public.workspaces,public.workspace_memberships from public,anon,authenticated;
grant select on public.workspaces,public.workspace_memberships to authenticated;
create policy "Read own membership" on public.workspace_memberships for select to authenticated using(user_id=auth.uid());
create policy "Read active workspace" on public.workspaces for select to authenticated
using(exists(select 1 from public.workspace_memberships m where m.workspace_id=id and m.user_id=auth.uid() and m.is_active));
insert into public.workspaces(id,organization_id,owner_id,kind)
  select id,id,owner_id,'business' from public.organizations;
insert into public.workspaces(id,owner_id,kind)
  select id,id,'individual' from public.users where account_type in ('personal','freelancer');
insert into public.workspace_memberships(user_id,workspace_id,role,is_active)
  select id,case when account_type='business' then organization_id else id end,
    case when account_type='business' then role::text else 'OWNER' end,is_active
  from public.users where account_type in ('personal','freelancer') or (account_type='business' and organization_id is not null);

-- Legacy users fields remain a compatibility interface for existing clients.
-- Protected profile writes synchronize membership in the same transaction.
create function amountly_private.sync_workspace_membership() returns trigger
language plpgsql security definer set search_path='' as $$
declare workspace_id uuid; existing_id uuid;
begin
  workspace_id:=case when new.account_type='business' then new.organization_id
    when new.account_type in ('personal','freelancer') then new.id else null end;
  select m.workspace_id into existing_id from public.workspace_memberships m where m.user_id=new.id;
  if existing_id is not null and workspace_id is distinct from existing_id then
    raise exception 'Workspace migration requires a dedicated operation' using errcode='42501'; end if;
  if workspace_id is null then return new; end if;
  if new.account_type='business' then
    insert into public.workspaces(id,organization_id,owner_id,kind)
      select o.id,o.id,o.owner_id,'business' from public.organizations o where o.id=workspace_id on conflict(id) do nothing;
  else insert into public.workspaces(id,owner_id,kind) values(new.id,new.id,'individual') on conflict(id) do nothing; end if;
  insert into public.workspace_memberships(user_id,workspace_id,role,is_active)
    values(new.id,workspace_id,case when new.account_type='business' then new.role::text else 'OWNER' end,new.is_active)
    on conflict(user_id) do update set role=excluded.role,is_active=excluded.is_active;
  return new;
end $$;
create trigger sync_workspace_membership after insert or update on public.users for each row execute function amountly_private.sync_workspace_membership();
revoke all on function amountly_private.sync_workspace_membership() from public,anon,authenticated;

create or replace function amountly_private.active_actor() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.users u left join public.workspace_memberships m on m.user_id=u.id
    where u.id=auth.uid() and u.is_active is true and (m.is_active is true or (u.account_type='business' and u.organization_id is null)))
$$;

-- Vendor fields previously discarded by the compatibility adapter now persist.
-- Missing historical values stay unknown; no location or tax details are invented.
alter table public.vendors add column city text,add column state text,add column zip_code text,
  add column country text,add column tax_id text,add column payment_terms integer,
  add column archived_at timestamptz;
create function amountly_private.protect_vendor() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Archive vendors to preserve history' using errcode='42501'; end if;
  if tg_op='UPDATE' and (new.user_id is distinct from old.user_id or new.organization_id is distinct from old.organization_id) then
    raise exception 'Vendor workspace cannot change' using errcode='42501'; end if;
  if not exists(select 1 from public.users u where u.id=auth.uid() and u.is_active is true and new.user_id=u.id
    and (u.account_type='freelancer' or (u.account_type='business' and u.role in ('OWNER','ADMIN')))
    and (new.organization_id is null or new.organization_id=u.organization_id)) and current_user='authenticated' then
    raise exception 'Not permitted' using errcode='42501'; end if;
  if length(btrim(new.name)) not between 1 and 200 or length(coalesce(new.email,''))>320
    or length(coalesce(new.phone,''))>50 or length(coalesce(new.address,''))>1000
    or length(coalesce(new.city,''))>100 or length(coalesce(new.state,''))>100
    or length(coalesce(new.zip_code,''))>30 or length(coalesce(new.country,''))>100
    or length(coalesce(new.tax_id,''))>100 or length(coalesce(new.notes,''))>5000
    or (new.payment_terms is not null and new.payment_terms not between 0 and 365) then
    raise exception 'Invalid vendor fields' using errcode='22023'; end if;
  return new;
end $$;
create trigger protect_vendor before insert or update or delete on public.vendors for each row execute function amountly_private.protect_vendor();
revoke all on function amountly_private.protect_vendor() from public,anon,authenticated;

-- A common directory over preserved source records. security_invoker keeps
-- client and vendor visibility governed by their existing policies. An entity
-- that is both a customer and vendor keeps both roles and its original IDs.
create view public.workspace_contacts with(security_invoker=true) as
  select 'client:'||id::text as contact_key,id,'client'::text as kind,name,email,phone,address,city,state,zip_code,country,archived_at
    from public.clients
  union all
  select 'vendor:'||id::text,id,'vendor'::text,name,email,phone,address,city,state,zip_code,country,archived_at
    from public.vendors;
revoke all on public.workspace_contacts from public,anon,authenticated;
grant select on public.workspace_contacts to authenticated;

-- Archive prevents new obligations, while existing bills remain payable.
-- Share-lock the vendor so concurrent archive/create operations serialize.
create function amountly_private.require_active_bill_vendor() returns trigger
language plpgsql security invoker set search_path='' as $$
declare archived timestamptz;
begin
  select archived_at into archived from public.vendors where id=new.vendor_id for share;
  if not found or archived is not null then
    raise exception 'Choose an active vendor' using errcode='22023';
  end if;
  return new;
end $$;
create trigger require_active_bill_vendor before insert on public.vendor_bills
for each row execute function amountly_private.require_active_bill_vendor();
revoke all on function amountly_private.require_active_bill_vendor() from public,anon,authenticated;
