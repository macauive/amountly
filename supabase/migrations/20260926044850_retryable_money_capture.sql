-- A create request and its financial record commit together. Identical retries
-- return the original ID, including after subsequent edits/payment/archive.
-- Payloads stay in the private database schema, never browser storage or logs.
create table amountly_private.capture_requests (
  kind text not null check(kind in ('bills','expenses','vendor_bills')),
  request_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key(kind,request_id)
);
alter table amountly_private.capture_requests enable row level security;
revoke all on amountly_private.capture_requests from public,anon,authenticated;

-- Retain the existing atomic vendor validation/insertion as an internal helper.
alter function amountly_private.save_vendor_bill(uuid,jsonb,jsonb) rename to insert_vendor_bill;
revoke all on function amountly_private.insert_vendor_bill(uuid,jsonb,jsonb) from public,anon,authenticated;

create function amountly_private.create_money_record(p_kind text,p_id uuid,p_data jsonb,p_lines jsonb default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor public.users; prior amountly_private.capture_requests; request_payload jsonb;
  amount_value numeric; allowed text[]; field record;
begin
  select * into actor from public.users where id=auth.uid() and is_active is true;
  if actor.id is null or not amountly_private.active_actor() then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('bills','expenses','vendor_bills') or p_id is null
    or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>16000 then
    raise exception 'Invalid capture request' using errcode='22023'; end if;
  if p_kind='vendor_bills' then
    if actor.account_type not in ('business','freelancer') or (actor.account_type='business' and actor.role not in ('OWNER','ADMIN')) then
      raise exception 'Not permitted' using errcode='42501'; end if;
    if jsonb_typeof(p_lines) is distinct from 'array' or octet_length(p_lines::text)>150000 then
      raise exception 'Invalid lines' using errcode='22023'; end if;
  elsif p_lines is not null then raise exception 'Unexpected lines' using errcode='22023';
  end if;
  -- Global record IDs serialize requests even if a different actor guesses one.
  perform pg_advisory_xact_lock(hashtextextended(p_kind||p_id::text,4));
  request_payload:=jsonb_build_object('data',p_data,'lines',p_lines);
  select * into prior from amountly_private.capture_requests where kind=p_kind and request_id=p_id;
  if found then
    if prior.actor_id is distinct from actor.id then raise exception 'Not permitted' using errcode='42501'; end if;
    if prior.payload is distinct from request_payload then raise exception 'Request contents changed' using errcode='22023'; end if;
    return p_id;
  end if;
  if p_kind='vendor_bills' then
    perform amountly_private.insert_vendor_bill(p_id,p_data,p_lines);
  else
    if p_data ? 'user_id' and p_data->>'user_id' is distinct from actor.id::text then
      raise exception 'Not permitted' using errcode='42501'; end if;
    allowed:=case when p_kind='bills' then array['user_id','name','payee','amount','currency','category','due_date','status','recurrence','auto_pay','notes']
      else array['user_id','amount','currency','category','description','merchant','expense_date','project_id','task_id','receipt_path','status','notes'] end;
    if exists(select 1 from jsonb_object_keys(p_data) k where not k=any(allowed))
      or jsonb_typeof(p_data->'amount') is distinct from 'number' then
      raise exception 'Invalid fields' using errcode='22023'; end if;
    for field in select key,value from jsonb_each(p_data) where key not in ('amount','auto_pay') loop
      if jsonb_typeof(field.value) not in ('string','null') then raise exception 'Invalid field type' using errcode='22023'; end if;
    end loop;
    amount_value:=(p_data->>'amount')::numeric;
    if amount_value<=0 or amount_value>=100000000 or amount_value<>round(amount_value,2)
      or coalesce(p_data->>'currency','USD') not in ('USD','EUR','GBP','CAD','AUD') then
      raise exception 'Invalid amount or currency' using errcode='22023'; end if;
    if p_kind='bills' then
      if coalesce(p_data->>'status','upcoming')<>'upcoming'
        or coalesce(p_data->>'due_date','') !~ '^\d{4}-\d{2}-\d{2}$'
        or (p_data ? 'auto_pay' and jsonb_typeof(p_data->'auto_pay') is distinct from 'boolean') then
        raise exception 'Invalid bill fields' using errcode='22023'; end if;
      insert into public.bills(id,user_id,name,payee,amount,currency,category,due_date,status,recurrence,auto_pay,notes)
        values(p_id,actor.id,btrim(p_data->>'name'),btrim(p_data->>'payee'),amount_value,coalesce(p_data->>'currency','USD'),
          p_data->>'category',(p_data->>'due_date')::date,'upcoming',coalesce(p_data->>'recurrence','monthly'),coalesce((p_data->>'auto_pay')::boolean,false),p_data->>'notes');
    else
      if coalesce(p_data->>'status','DRAFT')<>'DRAFT'
        or coalesce(p_data->>'expense_date','') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Invalid expense fields' using errcode='22023'; end if;
      -- This command runs as its owner, so check the receipt boundary here as
      -- well as in the existing trigger for direct authenticated writes.
      if p_data->>'receipt_path' is not null and (
        p_data->>'receipt_path' !~ ('^'||actor.id::text||'/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|pdf)$')) then
        raise exception 'Invalid receipt object path' using errcode='42501'; end if;
      insert into public.expenses(id,user_id,amount,currency,category,description,merchant,expense_date,project_id,task_id,receipt_path,status,notes)
        values(p_id,actor.id,amount_value,coalesce(p_data->>'currency','USD'),(p_data->>'category')::public.expense_category_enum,
          p_data->>'description',p_data->>'merchant',(p_data->>'expense_date')::date::timestamp at time zone 'UTC',
          (p_data->>'project_id')::uuid,(p_data->>'task_id')::uuid,p_data->>'receipt_path','DRAFT',p_data->>'notes');
    end if;
  end if;
  insert into amountly_private.capture_requests(kind,request_id,actor_id,payload) values(p_kind,p_id,actor.id,request_payload);
  return p_id;
end $$;
create function public.create_money_record(p_kind text,p_id uuid,p_data jsonb) returns uuid
language sql security invoker set search_path='' as $$select amountly_private.create_money_record(p_kind,p_id,p_data)$$;
create or replace function public.save_vendor_bill(p_id uuid,p_data jsonb,p_lines jsonb) returns uuid
language sql security invoker set search_path='' as $$select amountly_private.create_money_record('vendor_bills',p_id,p_data,p_lines)$$;
revoke all on function amountly_private.create_money_record(text,uuid,jsonb,jsonb),public.create_money_record(text,uuid,jsonb) from public,anon;
grant execute on function amountly_private.create_money_record(text,uuid,jsonb,jsonb),public.create_money_record(text,uuid,jsonb) to authenticated;
