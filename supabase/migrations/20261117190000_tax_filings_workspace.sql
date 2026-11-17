-- Preserve user ownership and the filing itself. Repair only the legacy
-- workspace reference using each owner's current profile.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.tax_filings'::regclass and conname = 'tax_filings_organization_id_fkey'
  ) then
    alter table public.tax_filings add constraint tax_filings_organization_id_fkey
      foreign key (organization_id) references public.organizations(id) not valid;

    with scopes as (
      select filing.id, case when profile.account_type = 'business' then org.id end as organization_id
      from public.tax_filings as filing
      left join public.users as profile on profile.id = filing.user_id
      left join public.organizations as org on org.id = profile.organization_id
    )
    update public.tax_filings as filing
       set organization_id = scopes.organization_id
      from scopes
     where filing.id = scopes.id and filing.organization_id is distinct from scopes.organization_id;
  end if;
end $$;

alter table public.tax_filings validate constraint tax_filings_organization_id_fkey;

create or replace function public.enforce_tax_filing_workspace() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id or new.user_id is distinct from old.user_id then
      raise exception 'Filing ownership cannot change' using errcode = '42501';
    end if;
    return new;
  end if;
  if not exists (
    select 1 from public.users as actor
    where actor.id = new.user_id and actor.is_active
      and ((actor.account_type in ('personal', 'freelancer') and new.organization_id is null)
        or (actor.account_type = 'business' and new.organization_id = actor.organization_id))
  ) then
    raise exception 'Invalid filing workspace' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.enforce_tax_filing_workspace() from public, anon, authenticated;
drop trigger if exists tax_filing_workspace on public.tax_filings;
create trigger tax_filing_workspace before insert or update of organization_id, user_id
  on public.tax_filings for each row execute function public.enforce_tax_filing_workspace();

-- Quarterly reminders use the same scope as a filing created from the form.
create or replace function public.seed_quarterly_estimates(p_year integer) returns void
language plpgsql security invoker set search_path = '' as $$
declare q integer; starts date[]; ends date[]; dues date[]; filing_org uuid;
begin
  if p_year not in (2025,2026) or p_year is null then raise exception 'Unsupported tax year' using errcode='22023'; end if;
  if not amountly_private.active_actor() then raise exception 'Not permitted' using errcode='42501'; end if;
  select case when account_type = 'business' then organization_id end into filing_org
    from public.users where id = auth.uid();
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':quarter-reminders:'||p_year::text,4));
  starts:=array[make_date(p_year,1,1),make_date(p_year,4,1),make_date(p_year,7,1),make_date(p_year,10,1)];
  ends:=array[make_date(p_year,3,31),make_date(p_year,6,30),make_date(p_year,9,30),make_date(p_year,12,31)];
  dues:=array[make_date(p_year,4,15),make_date(p_year,6,case when p_year=2025 then 16 else 15 end),make_date(p_year,9,15),make_date(p_year+1,1,15)];
  for q in 1..4 loop
    if not exists(select 1 from public.tax_filings where user_id=auth.uid() and form_type='1040-ES'
      and tax_period_start=starts[q] and tax_period_end=ends[q]) then
      insert into public.tax_filings(user_id,organization_id,name,form_type,tax_period_start,tax_period_end,due_date,status)
        values(auth.uid(),filing_org,'Q'||q::text||' '||p_year::text||' Estimated Tax','1040-ES',starts[q],ends[q],dues[q],'not_started');
    end if;
  end loop;
end $$;
