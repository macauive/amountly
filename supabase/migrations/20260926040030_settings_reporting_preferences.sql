alter table public.users add column preferences jsonb not null default '{}';
create function amountly_private.validate_preferences() returns trigger
language plpgsql security invoker set search_path='' as $$
declare p jsonb:=new.preferences; k text; val jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>4000 then raise exception 'Invalid preferences' using errcode='22023'; end if;
  for k,val in select key,value from jsonb_each(p) loop
    if k in ('default_tax_rate','fiscal_year_start','payment_terms') then
      if jsonb_typeof(val)<>'number' then raise exception 'Invalid preference value' using errcode='22023'; end if;
      if (k='default_tax_rate' and ((val::text)::numeric not between 0 and 100 or (val::text)::numeric<>round((val::text)::numeric,2)))
        or (k='fiscal_year_start' and ((val::text)::numeric not between 1 and 12 or (val::text)::numeric<>trunc((val::text)::numeric)))
        or (k='payment_terms' and ((val::text)::numeric not between 0 and 365 or (val::text)::numeric<>trunc((val::text)::numeric))) then
        raise exception 'Invalid preference value' using errcode='22023'; end if;
    elsif k='default_currency' then
      if p->>k not in ('USD','EUR','GBP','CAD','AUD') or jsonb_typeof(val)<>'string' then raise exception 'Invalid currency' using errcode='22023'; end if;
    elsif k='date_format' then
      if p->>k not in ('MM/DD/YYYY','DD/MM/YYYY','YYYY-MM-DD') or jsonb_typeof(val)<>'string' then raise exception 'Invalid date format' using errcode='22023'; end if;
    elsif k='accounting_basis' then
      if p->>k not in ('cash','accrual') or jsonb_typeof(val)<>'string' then raise exception 'Invalid reporting basis' using errcode='22023'; end if;
    elsif k='notifications' then
      if jsonb_typeof(val)<>'object' then raise exception 'Invalid notifications' using errcode='22023'; end if;
      if exists(select 1 from jsonb_each(val) item where item.key not in ('overdue_invoices','bill_due_reminders','payroll_confirmation','low_stock_alerts','weekly_summary') or jsonb_typeof(item.value)<>'boolean') then
        raise exception 'Invalid notifications' using errcode='22023'; end if;
    else raise exception 'Unsupported preference' using errcode='22023'; end if;
  end loop;
  return new;
end $$;
create trigger validate_preferences before insert or update of preferences on public.users for each row execute function amountly_private.validate_preferences();
revoke all on function amountly_private.validate_preferences() from public,anon,authenticated;
create function public.set_own_preferences(p_patch jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if jsonb_typeof(p_patch) is distinct from 'object' or octet_length(p_patch::text)>4000 then raise exception 'Invalid preferences' using errcode='22023'; end if;
  update public.users set preferences=preferences||p_patch where id=auth.uid() and is_active is true;
  if not found then raise exception 'Not permitted' using errcode='42501'; end if;
end $$;
revoke all on function public.set_own_preferences(jsonb) from public,anon;
grant execute on function public.set_own_preferences(jsonb) to authenticated;

-- Missing reminders can be added repeatedly or concurrently without duplicating
-- previously recorded periods. Existing amounts/statuses are never overwritten.
create function public.seed_quarterly_estimates(p_year integer) returns void
language plpgsql security invoker set search_path='' as $$
declare q integer; starts date[]; ends date[]; dues date[];
begin
  if p_year not in (2025,2026) or p_year is null then raise exception 'Unsupported tax year' using errcode='22023'; end if;
  if not amountly_private.active_actor() then raise exception 'Not permitted' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':quarter-reminders:'||p_year::text,4));
  starts:=array[make_date(p_year,1,1),make_date(p_year,4,1),make_date(p_year,6,1),make_date(p_year,9,1)];
  ends:=array[make_date(p_year,3,31),make_date(p_year,5,31),make_date(p_year,8,31),make_date(p_year,12,31)];
  dues:=array[make_date(p_year,4,15),make_date(p_year,6,case when p_year=2025 then 16 else 15 end),make_date(p_year,9,15),make_date(p_year+1,1,15)];
  for q in 1..4 loop
    if not exists(select 1 from public.tax_filings where user_id=auth.uid() and form_type='1040-ES'
      and tax_period_start=starts[q] and tax_period_end=ends[q]) then
      insert into public.tax_filings(user_id,name,form_type,tax_period_start,tax_period_end,due_date,status)
        values(auth.uid(),'Q'||q::text||' '||p_year::text||' Estimated Tax','1040-ES',starts[q],ends[q],dues[q],'not_started');
    end if;
  end loop;
end $$;
revoke all on function public.seed_quarterly_estimates(integer) from public,anon;
grant execute on function public.seed_quarterly_estimates(integer) to authenticated;
