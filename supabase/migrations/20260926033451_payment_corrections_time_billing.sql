-- Corrections preserve the original receipt. These are bookkeeping corrections,
-- not refunds or transfers. A replacement receipt is recorded separately.
create table public.invoice_payment_reversals (
  id uuid primary key,
  payment_id uuid not null unique references public.invoice_payments(id) on delete restrict,
  reason text not null check (length(btrim(reason)) between 5 and 500),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
alter table public.invoice_payment_reversals enable row level security;
revoke all on public.invoice_payment_reversals from public, anon, authenticated;
grant select on public.invoice_payment_reversals to authenticated;
create policy "Read scoped payment corrections" on public.invoice_payment_reversals for select to authenticated
using (exists(select 1 from public.invoice_payments p where p.id=payment_id));
alter table public.invoice_events drop constraint invoice_events_action_check;
alter table public.invoice_events add constraint invoice_events_action_check
check (action in ('created','updated','issued','payment_recorded','payment_reversed','time_reserved','cancelled'));

create function amountly_private.reverse_invoice_payment(p_id uuid,p_payment_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare receipt public.invoice_payments; i public.invoices; prior public.invoice_payment_reversals; v_paid numeric;
begin
  select * into receipt from public.invoice_payments where id=p_payment_id;
  select * into i from public.invoices where id=receipt.invoice_id for update;
  if i.id is null or not public.can_access_financial_record(i.organization_id,i.user_id,'invoice','write') then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  if p_id is null or p_reason is null or length(btrim(p_reason)) not between 5 and 500 then
    raise exception 'Enter a correction reason' using errcode='22023';
  end if;
  select * into prior from public.invoice_payment_reversals where id=p_id;
  if prior.id is not null then
    if prior.payment_id=p_payment_id and prior.reason=btrim(p_reason) and prior.recorded_by=auth.uid() then return prior.id; end if;
    raise exception 'Request already used' using errcode='22023';
  end if;
  if exists(select 1 from public.invoice_payment_reversals where payment_id=p_payment_id) then
    raise exception 'Payment already corrected' using errcode='PT409';
  end if;
  if i.status not in ('SENT','OVERDUE','PAID') then raise exception 'Invalid invoice state' using errcode='22023'; end if;
  insert into public.invoice_payment_reversals(id,payment_id,reason,recorded_by) values(p_id,p_payment_id,btrim(p_reason),auth.uid());
  select coalesce(sum(amount),0) into v_paid from public.invoice_payments p
    where p.invoice_id=i.id and not exists(select 1 from public.invoice_payment_reversals r where r.payment_id=p.id);
  update public.invoices set status=case when v_paid=total then 'PAID'::public.invoice_status_enum else 'SENT'::public.invoice_status_enum end,
    paid_at=case when v_paid=total then paid_at else null end where id=i.id;
  insert into public.invoice_events(invoice_id,actor_id,action) values(i.id,auth.uid(),'payment_reversed');
  return p_id;
end $$;
create function public.reverse_invoice_payment(p_id uuid,p_payment_id uuid,p_reason text)
returns uuid language sql security invoker set search_path='' as $$ select amountly_private.reverse_invoice_payment(p_id,p_payment_id,p_reason) $$;
revoke all on function amountly_private.reverse_invoice_payment(uuid,uuid,text),public.reverse_invoice_payment(uuid,uuid,text) from public,anon;
grant execute on function amountly_private.reverse_invoice_payment(uuid,uuid,text),public.reverse_invoice_payment(uuid,uuid,text) to authenticated;

-- Keep the existing validation/idempotency rules; exclude corrected receipts
-- from both the balance and paid date when accepting a replacement payment.
do $$ declare definition text; begin
  definition := pg_get_functiondef('amountly_private.record_invoice_payment(uuid,uuid,numeric,date,text,text)'::regprocedure);
  if position('from public.invoice_payments where invoice_id=p_invoice_id' in definition)=0 then
    raise exception 'Unexpected payment function definition';
  end if;
  execute replace(definition,'from public.invoice_payments where invoice_id=p_invoice_id',
    'from public.invoice_payments p where invoice_id=p_invoice_id and not exists (select 1 from public.invoice_payment_reversals r where r.payment_id=p.id)');
end $$;

-- Active reservations are unique across invoices. Cancelled invoices retain
-- their original time snapshot but release the work for a replacement invoice.
create table public.invoice_time_links (
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  time_entry_id uuid not null references public.time_entries(id) on delete restrict,
  source_snapshot jsonb not null,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  primary key(invoice_id,time_entry_id)
);
create unique index invoice_time_one_active on public.invoice_time_links(time_entry_id) where released_at is null;
alter table public.invoice_time_links enable row level security;
revoke all on public.invoice_time_links from public,anon,authenticated;
grant select on public.invoice_time_links to authenticated;
create policy "Read own work billing links" on public.invoice_time_links for select to authenticated
using (exists(select 1 from public.time_entries t where t.id=time_entry_id));
-- Only the command can read retry payloads. No financial data is exposed by it.
create table amountly_private.time_invoice_requests (
  invoice_id uuid primary key references public.invoices(id) on delete cascade,
  actor_id uuid not null,
  payload jsonb not null
);
revoke all on amountly_private.time_invoice_requests from public,anon,authenticated;

create function amountly_private.protect_billed_time() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.invoice_time_links where time_entry_id=old.id and released_at is null)
    or old.invoice_id is not null then
    raise exception 'Linked time must be preserved' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger protect_billed_time before update or delete on public.time_entries
for each row execute function amountly_private.protect_billed_time();

create function amountly_private.protect_time_invoice_lines() returns trigger
language plpgsql security definer set search_path='' as $$
declare parent_id uuid;
begin
  if tg_op='INSERT' then parent_id:=new.invoice_id; else parent_id:=old.invoice_id; end if;
  if exists(select 1 from amountly_private.time_invoice_requests where invoice_id=parent_id)
    and exists(select 1 from public.invoices where id=parent_id) then
    raise exception 'Recreate the time draft to change its lines' using errcode='22023';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger protect_time_invoice_lines before insert or update or delete on public.invoice_line_items
for each row execute function amountly_private.protect_time_invoice_lines();

create function amountly_private.release_cancelled_time() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='CANCELLED' and old.status is distinct from new.status then
    update public.invoice_time_links set released_at=now() where invoice_id=new.id and released_at is null;
  end if;
  return new;
end $$;
create trigger release_cancelled_time after update on public.invoices
for each row execute function amountly_private.release_cancelled_time();

create function amountly_private.create_invoice_from_time(p_id uuid,p_entry_ids uuid[],p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor public.users; t public.time_entries; owner_profile public.users; v_project public.projects;
  v_ids uuid[]; v_id uuid; v_payload jsonb; prior amountly_private.time_invoice_requests;
  v_lines jsonb:='[]'; v_rate numeric; v_amount numeric;
begin
  select * into actor from public.users where id=auth.uid() and is_active is true;
  if actor.id is null or p_id is null or actor.account_type not in ('business','freelancer')
    or (actor.account_type='business' and (actor.organization_id is null or actor.role not in ('OWNER','ADMIN'))) then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  if p_entry_ids is null or cardinality(p_entry_ids) not between 1 and 100
    or array_position(p_entry_ids,null) is not null
    or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>16000 then
    raise exception 'Choose between 1 and 100 time entries' using errcode='22023';
  end if;
  select array_agg(distinct e order by e) into v_ids from unnest(p_entry_ids) e;
  if cardinality(v_ids)<>cardinality(p_entry_ids) then raise exception 'Duplicate entries' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('entries',v_ids,'data',p_data);
  -- Serialize retries of the same request before looking for an existing draft.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select * into prior from amountly_private.time_invoice_requests where invoice_id=p_id;
  if prior.invoice_id is not null then
    if prior.actor_id=actor.id and prior.payload=v_payload and exists(select 1 from public.invoices i
      where i.id=p_id and public.can_access_financial_record(i.organization_id,i.user_id,'invoice','write')) then return p_id; end if;
    raise exception 'Request already used' using errcode='22023';
  end if;
  if exists(select 1 from public.invoices where id=p_id) then raise exception 'Request already used' using errcode='22023'; end if;
  select * into v_project from public.projects where id=(p_data->>'project_id')::uuid;
  if v_project.id is null or v_project.archived_at is not null or v_project.client_id is null
    or v_project.client_id is distinct from (p_data->>'client_id')::uuid
    or not public.can_access_financial_record(v_project.organization_id,v_project.user_id,'invoice','write') then
    raise exception 'Choose an active project and its client' using errcode='42501';
  end if;
  -- Sorted row locks serialize overlapping selections, including edits to time.
  foreach v_id in array v_ids loop
    select * into t from public.time_entries where id=v_id for update;
    select * into owner_profile from public.users where id=t.user_id;
    if t.id is null or t.project_id is distinct from v_project.id
      or (actor.account_type='business' and owner_profile.organization_id is distinct from actor.organization_id)
      or (actor.account_type='freelancer' and t.user_id<>actor.id) then
      raise exception 'Not permitted' using errcode='42501';
    end if;
    if t.invoice_id is not null or exists(select 1 from public.invoice_time_links where time_entry_id=t.id and released_at is null) then
      raise exception 'Time already reserved' using errcode='PT409';
    end if;
    if (actor.account_type='business' and t.status<>'APPROVED')
      or (actor.account_type='freelancer' and t.status not in ('DRAFT','SUBMITTED','APPROVED'))
      or t.duration_minutes is null or t.duration_minutes not between 1 and 1440
      or t.end_at is null or t.end_at<=t.start_at
      or t.duration_minutes<>round(extract(epoch from (t.end_at-t.start_at))/60) then
      raise exception 'Review time duration and approval first' using errcode='22023';
    end if;
    v_rate:=t.billable_rate;
    if v_rate is null or v_rate<=0 or v_rate>999999 or v_rate<>round(v_rate,2) then
      raise exception 'Set a valid hourly rate on every entry' using errcode='22023';
    end if;
    v_amount:=round(t.duration_minutes*v_rate/60,2);
    if v_amount<=0 or v_amount>999999 then raise exception 'Unsupported time amount' using errcode='22023'; end if;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('description',left(coalesce(nullif(btrim(t.notes),''),v_project.name),800)
      ||' ('||t.duration_minutes||' min @ '||v_rate||' '||(p_data->>'currency')||'/hr)', 'quantity',1,'rate',v_amount));
  end loop;
  perform amountly_private.save_invoice(p_id,p_data,v_lines,null);
  insert into amountly_private.time_invoice_requests values(p_id,actor.id,v_payload);
  insert into public.invoice_time_links(invoice_id,time_entry_id,source_snapshot)
    select p_id,source.id,jsonb_build_object('start_at',source.start_at,'end_at',source.end_at,'duration_minutes',source.duration_minutes,
      'billable_rate',source.billable_rate,'notes',source.notes,'user_id',source.user_id,'project_id',source.project_id)
    from public.time_entries source where source.id=any(v_ids);
  insert into public.invoice_events(invoice_id,actor_id,action) values(p_id,actor.id,'time_reserved');
  return p_id;
end $$;
create function public.create_invoice_from_time(p_id uuid,p_entry_ids uuid[],p_data jsonb)
returns uuid language sql security invoker set search_path='' as $$ select amountly_private.create_invoice_from_time(p_id,p_entry_ids,p_data) $$;
revoke all on function amountly_private.create_invoice_from_time(uuid,uuid[],jsonb),public.create_invoice_from_time(uuid,uuid[],jsonb) from public,anon;
grant execute on function amountly_private.create_invoice_from_time(uuid,uuid[],jsonb),public.create_invoice_from_time(uuid,uuid[],jsonb) to authenticated;
revoke all on function amountly_private.protect_billed_time(),amountly_private.protect_time_invoice_lines(),amountly_private.release_cancelled_time() from public,anon,authenticated;
