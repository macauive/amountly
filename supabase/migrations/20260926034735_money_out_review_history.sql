-- Preserve review evidence across time, expenses, and bills. Historical rows
-- are not rewritten and no historical review/payment events are fabricated.
alter table public.expenses add column archived_at timestamptz;
create table public.record_events (
  id uuid primary key default gen_random_uuid(),
  record_type text not null check(record_type in ('expenses','time_entries','bills','vendor_bills')),
  record_id uuid not null,
  actor_id uuid references auth.users(id) on delete restrict,
  action text not null,
  previous_status text,
  next_status text,
  changed_fields text[] not null default '{}',
  previous_values jsonb,
  next_values jsonb not null,
  created_at timestamptz not null default now()
);
create index record_events_record on public.record_events(record_type,record_id,created_at);
alter table public.record_events enable row level security;
revoke all on public.record_events from public,anon,authenticated;
grant select on public.record_events to authenticated;
create policy "Read visible record history" on public.record_events for select to authenticated using (
  (record_type='expenses' and exists(select 1 from public.expenses e where e.id=record_id))
  or (record_type='time_entries' and exists(select 1 from public.time_entries t where t.id=record_id))
  or (record_type='bills' and exists(select 1 from public.bills b where b.id=record_id))
  or (record_type='vendor_bills' and exists(select 1 from public.vendor_bills b where b.id=record_id))
);
create function amountly_private.record_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare fields text[]; before_values jsonb; after_values jsonb;
  audited text[]:=array['amount','currency','expense_date','category','duration_minutes','billable_rate','start_at','end_at','due_date','paid_at','subtotal','tax_rate','tax_amount','total','status','archived_at'];
begin
  if tg_op='UPDATE' then
    select array_agg(key order by key) into fields from jsonb_each(to_jsonb(new))
      where key not in ('updated_at','receipt_url','receipt_path') and value is distinct from to_jsonb(old)->key;
    if fields is null then return new; end if;
  end if;
  select coalesce(jsonb_object_agg(key,value),'{}') into after_values from jsonb_each(to_jsonb(new)) where key=any(audited);
  if tg_op='UPDATE' then select coalesce(jsonb_object_agg(key,value),'{}') into before_values from jsonb_each(to_jsonb(old)) where key=any(audited); end if;
  insert into public.record_events(record_type,record_id,actor_id,action,previous_status,next_status,changed_fields,previous_values,next_values)
    values(tg_table_name,new.id,auth.uid(),case when tg_op='INSERT' then 'created'
      when to_jsonb(new)->>'archived_at' is not null and to_jsonb(old)->>'archived_at' is null then 'archived'
      when new.status::text is distinct from old.status::text then 'status_changed' else 'updated' end,
      case when tg_op='UPDATE' then old.status::text end,new.status::text,coalesce(fields,'{}'),before_values,after_values);
  return new;
end $$;
do $$ declare table_name text; begin
  foreach table_name in array array['expenses','time_entries','bills','vendor_bills'] loop
    execute format('create trigger record_change after insert or update on public.%I for each row execute function amountly_private.record_change()',table_name);
  end loop;
end $$;
revoke all on function amountly_private.record_change() from public,anon,authenticated;

-- Rejected work may be corrected and resubmitted by its owner. Approved work
-- still requires an independent reviewer and cannot be rewritten.
create function amountly_private.can_review_work(owner_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.users actor join public.users owner_profile on owner_profile.id=owner_id
    where actor.id=auth.uid() and actor.is_active is true and actor.account_type='business'
      and actor.id<>owner_id and actor.role in ('OWNER','ADMIN') and actor.organization_id=owner_profile.organization_id)
$$;
revoke all on function amountly_private.can_review_work(uuid) from public,anon;
grant execute on function amountly_private.can_review_work(uuid) to authenticated;
create policy "Independent expense review" on public.expenses for update to authenticated
using (status='SUBMITTED' and amountly_private.can_review_work(user_id))
with check (status in ('APPROVED','REJECTED') and amountly_private.can_review_work(user_id));
create policy "Independent time review" on public.time_entries for update to authenticated
using (status='SUBMITTED' and amountly_private.can_review_work(user_id))
with check (status in ('APPROVED','REJECTED') and amountly_private.can_review_work(user_id));
do $$ declare definition text; begin
  definition:=pg_get_functiondef('amountly_private.protect_work_record()'::regprocedure);
  execute replace(definition,'coalesce(old_state,''DRAFT'') not in (''DRAFT'',''SUBMITTED'')','coalesce(old_state,''DRAFT'') not in (''DRAFT'',''SUBMITTED'',''REJECTED'')');
end $$;

create function public.review_work_record(p_kind text,p_id uuid,p_action text,p_expected_updated_at timestamptz)
returns void language plpgsql security invoker set search_path='' as $$
declare entry_id uuid; owner_id uuid; v_status text; v_updated timestamptz; next_status text;
begin
  if p_kind='expenses' then
    select id,user_id,status::text,updated_at into entry_id,owner_id,v_status,v_updated from public.expenses where id=p_id and archived_at is null for update;
  elsif p_kind='time_entries' then
    select id,user_id,status::text,updated_at into entry_id,owner_id,v_status,v_updated from public.time_entries where id=p_id for update;
  else raise exception 'Unsupported record' using errcode='22023'; end if;
  if entry_id is null then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_expected_updated_at is distinct from v_updated then raise exception 'Record changed' using errcode='PT409'; end if;
  if p_action='submit' and v_status in ('DRAFT','REJECTED') and owner_id=auth.uid() then next_status:='SUBMITTED';
  elsif p_action='approve' and v_status='SUBMITTED' then next_status:='APPROVED';
  elsif p_action='reject' and v_status='SUBMITTED' then next_status:='REJECTED';
  else raise exception 'Invalid review transition' using errcode='22023'; end if;
  -- RLS and protect_work_record independently enforce reviewer permissions.
  if p_kind='expenses' then update public.expenses set status=next_status::public.expense_status_enum where id=p_id;
  else update public.time_entries set status=next_status::public.time_entry_status_enum where id=p_id; end if;
end $$;
revoke all on function public.review_work_record(text,uuid,text,timestamptz) from public,anon;
grant execute on function public.review_work_record(text,uuid,text,timestamptz) to authenticated;

create function amountly_private.validate_money_out() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Preserve records by cancelling or archiving' using errcode='42501'; end if;
  if tg_op='UPDATE' and new.user_id is distinct from old.user_id then raise exception 'Ownership cannot change' using errcode='42501'; end if;
  if tg_table_name='bills' then
    if length(btrim(new.name)) not between 1 and 200 or length(btrim(new.payee)) not between 1 and 200
      or new.amount<=0 or new.amount>=100000000 or new.currency not in ('USD','EUR','GBP','CAD','AUD')
      or new.due_date not between date '2000-01-01' and date '2100-12-31'
      or new.category not in ('rent','utilities','insurance','subscription','loan','credit_card','phone','internet','other')
      or new.recurrence not in ('once','weekly','biweekly','monthly','quarterly','annually')
      or new.status not in ('upcoming','overdue','paid','cancelled') or length(coalesce(new.notes,''))>5000 then
      raise exception 'Invalid bill fields' using errcode='22023';
    end if;
    if tg_op='INSERT' and (new.status not in ('upcoming','overdue') or new.paid_at is not null) then raise exception 'Record payment separately' using errcode='22023'; end if;
    if tg_op='UPDATE' then
      if old.status in ('paid','cancelled') and (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
        raise exception 'Completed bills must be preserved' using errcode='42501';
      end if;
      if new.status='paid' and old.status<>'paid' then
        if new.paid_at is null or new.paid_at>now() or new.paid_at<timestamp '2000-01-01'
          or (to_jsonb(new)-array['status','paid_at','updated_at']) is distinct from (to_jsonb(old)-array['status','paid_at','updated_at']) then
          raise exception 'Invalid payment record' using errcode='22023'; end if;
      elsif new.paid_at is distinct from old.paid_at then raise exception 'Use a payment transition' using errcode='22023'; end if;
    end if;
    if tg_op='INSERT' then
      perform pg_advisory_xact_lock(hashtextextended(new.user_id::text||lower(btrim(new.payee))||new.due_date::text,1));
      if exists(select 1 from public.bills where user_id=new.user_id and lower(btrim(payee))=lower(btrim(new.payee))
        and lower(btrim(name))=lower(btrim(new.name)) and due_date=new.due_date and amount=new.amount and currency=new.currency and status<>'cancelled') then
        raise exception 'Possible duplicate bill' using errcode='PT409'; end if;
    end if;
  elsif tg_table_name='expenses' then
    if new.currency is null or new.currency not in ('USD','EUR','GBP','CAD','AUD')
      or length(coalesce(new.description,''))>1000 or length(coalesce(new.merchant,''))>200 or length(coalesce(new.notes,''))>5000
      or new.expense_date<timestamp '2000-01-01' or new.expense_date>timestamp '2101-01-01' then
      raise exception 'Invalid expense fields' using errcode='22023'; end if;
    if tg_op='UPDATE' and old.archived_at is not null then raise exception 'Archived expenses are preserved' using errcode='42501'; end if;
    if new.archived_at is not null and new.status not in ('DRAFT','REJECTED') then raise exception 'Reviewed expenses are preserved' using errcode='42501'; end if;
    if tg_op='INSERT' and new.receipt_path is not null then
      perform pg_advisory_xact_lock(hashtextextended(new.user_id::text||new.receipt_path,2));
      if exists(select 1 from public.expenses where user_id=new.user_id and receipt_path=new.receipt_path and archived_at is null) then
        raise exception 'Receipt already attached to an expense' using errcode='PT409'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger validate_money_out before insert or update or delete on public.bills for each row execute function amountly_private.validate_money_out();
create trigger validate_money_out before insert or update or delete on public.expenses for each row execute function amountly_private.validate_money_out();
revoke all on function amountly_private.validate_money_out() from public,anon,authenticated;

-- Bills did not previously update their version timestamp on changes.
create trigger bills_updated_at before update on public.bills for each row execute function public.update_updated_at_column();
create function public.bill_action(p_id uuid,p_action text,p_expected_updated_at timestamptz,p_paid_on date default null)
returns void language plpgsql security invoker set search_path='' as $$
declare b public.bills;
begin
  select * into b from public.bills where id=p_id for update;
  if b.id is null then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_expected_updated_at is distinct from b.updated_at then raise exception 'Record changed' using errcode='PT409'; end if;
  if b.status not in ('upcoming','overdue') then raise exception 'Invalid bill state' using errcode='22023'; end if;
  if p_action='pay' and p_paid_on is not null and p_paid_on between date '2000-01-01' and current_date then
    update public.bills set status='paid',paid_at=p_paid_on::timestamptz where id=p_id;
  elsif p_action='cancel' then update public.bills set status='cancelled' where id=p_id;
  else raise exception 'Invalid action' using errcode='22023'; end if;
end $$;
revoke all on function public.bill_action(uuid,text,timestamptz,date) from public,anon;
grant execute on function public.bill_action(uuid,text,timestamptz,date) to authenticated;

alter table public.vendor_bills add column currency text not null default 'USD';
create trigger vendor_bills_updated_at before update on public.vendor_bills for each row execute function public.update_updated_at_column();
create function amountly_private.vendor_bill_command_only() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if current_user in ('authenticated','anon') then raise exception 'Use the bill workflow' using errcode='42501'; end if;
  if tg_op='DELETE' then raise exception 'Cancel bills to preserve history' using errcode='42501'; end if;
  return new;
end $$;
create trigger vendor_bill_command_only before insert or update or delete on public.vendor_bills for each row execute function amountly_private.vendor_bill_command_only();
create trigger vendor_bill_lines_command_only before insert or update or delete on public.vendor_bill_line_items for each row execute function amountly_private.vendor_bill_command_only();
revoke all on function amountly_private.vendor_bill_command_only() from public,anon,authenticated;

create function amountly_private.save_vendor_bill(p_id uuid,p_data jsonb,p_lines jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor public.users; v public.vendors; item jsonb; subtotal numeric:=0; rate numeric; quantity numeric; tax numeric; v_index integer:=0;
begin
  select * into actor from public.users where id=auth.uid() and is_active is true;
  if actor.id is null or actor.account_type not in ('business','freelancer')
    or (actor.account_type='business' and actor.role not in ('OWNER','ADMIN')) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_id is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>16000
    or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('vendor_id','bill_number','issue_date','due_date','tax_rate','currency','notes'))
    or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 100 then
    raise exception 'Invalid bill' using errcode='22023'; end if;
  select * into v from public.vendors where id=(p_data->>'vendor_id')::uuid;
  if v.id is null or v.user_id is distinct from actor.id
    or (v.organization_id is not null and v.organization_id is distinct from actor.organization_id) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_data->>'bill_number' is null or length(btrim(p_data->>'bill_number')) not between 1 and 64
    or coalesce(p_data->>'issue_date','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_data->>'due_date','') !~ '^\d{4}-\d{2}-\d{2}$'
    or (p_data->>'issue_date')::date<date '2000-01-01' or (p_data->>'due_date')::date>date '2100-12-31'
    or (p_data->>'due_date')::date<(p_data->>'issue_date')::date
    or p_data->>'currency' is null or p_data->>'currency' not in ('USD','EUR','GBP','CAD','AUD')
    or length(coalesce(p_data->>'notes',''))>5000 then raise exception 'Invalid bill fields' using errcode='22023'; end if;
  tax:=coalesce((p_data->>'tax_rate')::numeric,0);
  if tax not between 0 and 100 or tax<>round(tax,2) then raise exception 'Invalid tax rate' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('description','quantity','rate'))
      or jsonb_typeof(item->'description') is distinct from 'string' or length(btrim(item->>'description')) not between 1 and 1000
      or jsonb_typeof(item->'quantity') is distinct from 'number' or jsonb_typeof(item->'rate') is distinct from 'number' then raise exception 'Invalid line' using errcode='22023'; end if;
    quantity:=(item->>'quantity')::numeric;rate:=(item->>'rate')::numeric;
    if quantity not between 0.01 and 100000 or rate not between 0 and 999999 or quantity<>round(quantity,2) or rate<>round(rate,2) then raise exception 'Invalid line values' using errcode='22023'; end if;
    subtotal:=subtotal+round(quantity*rate,2);
  end loop;
  if subtotal<=0 or subtotal+round(subtotal*tax/100,2)>=100000000 then raise exception 'Invalid total' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v.id::text||lower(btrim(p_data->>'bill_number')),3));
  if exists(select 1 from public.vendor_bills where vendor_id=v.id and lower(btrim(bill_number))=lower(btrim(p_data->>'bill_number')) and status<>'cancelled') then
    raise exception 'Bill number already recorded for this vendor' using errcode='PT409'; end if;
  insert into public.vendor_bills(id,user_id,organization_id,vendor_id,bill_number,date,due_date,subtotal,tax_rate,tax_amount,total,currency,notes)
    values(p_id,actor.id,v.organization_id,v.id,btrim(p_data->>'bill_number'),(p_data->>'issue_date')::date,(p_data->>'due_date')::date,
      subtotal,tax,round(subtotal*tax/100,2),subtotal+round(subtotal*tax/100,2),p_data->>'currency',p_data->>'notes');
  for item in select value from jsonb_array_elements(p_lines) loop
    insert into public.vendor_bill_line_items(vendor_bill_id,description,quantity,rate,amount,"order")
      values(p_id,btrim(item->>'description'),(item->>'quantity')::numeric,(item->>'rate')::numeric,round((item->>'quantity')::numeric*(item->>'rate')::numeric,2),v_index);
    v_index:=v_index+1;
  end loop;
  return p_id;
end $$;
create function amountly_private.vendor_bill_action(p_id uuid,p_action text,p_expected_updated_at timestamptz,p_paid_on date)
returns void language plpgsql security definer set search_path='' as $$
declare actor public.users; b public.vendor_bills;
begin
  select * into actor from public.users where id=auth.uid() and is_active is true;
  select * into b from public.vendor_bills where id=p_id for update;
  if actor.id is null or b.id is null or b.user_id is distinct from actor.id or actor.account_type not in ('business','freelancer')
    or (actor.account_type='business' and actor.role not in ('OWNER','ADMIN'))
    or (b.organization_id is not null and b.organization_id is distinct from actor.organization_id) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_expected_updated_at is distinct from b.updated_at then raise exception 'Record changed' using errcode='PT409'; end if;
  if b.status not in ('upcoming','overdue') then raise exception 'Invalid state' using errcode='22023'; end if;
  if p_action='pay' and p_paid_on is not null and p_paid_on between b.date and current_date then
    update public.vendor_bills set status='paid',paid_at=p_paid_on::timestamptz where id=p_id;
  elsif p_action='cancel' then update public.vendor_bills set status='cancelled' where id=p_id;
  else raise exception 'Invalid action' using errcode='22023'; end if;
end $$;
create function public.save_vendor_bill(p_id uuid,p_data jsonb,p_lines jsonb) returns uuid language sql security invoker set search_path='' as $$select amountly_private.save_vendor_bill(p_id,p_data,p_lines)$$;
create function public.vendor_bill_action(p_id uuid,p_action text,p_expected_updated_at timestamptz,p_paid_on date default null) returns void language sql security invoker set search_path='' as $$select amountly_private.vendor_bill_action(p_id,p_action,p_expected_updated_at,p_paid_on)$$;
revoke all on function amountly_private.save_vendor_bill(uuid,jsonb,jsonb),amountly_private.vendor_bill_action(uuid,text,timestamptz,date),public.save_vendor_bill(uuid,jsonb,jsonb),public.vendor_bill_action(uuid,text,timestamptz,date) from public,anon;
grant execute on function amountly_private.save_vendor_bill(uuid,jsonb,jsonb),amountly_private.vendor_bill_action(uuid,text,timestamptz,date),public.save_vendor_bill(uuid,jsonb,jsonb),public.vendor_bill_action(uuid,text,timestamptz,date) to authenticated;
