-- Explicit review only: never infer a receipt from a historical PAID flag.
create table public.legacy_payment_reviews (
  id uuid primary key,
  invoice_id uuid not null unique references public.invoices(id) on delete restrict,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  action text not null check(action in ('record_payment','reopen')),
  evidence text not null check(length(btrim(evidence)) between 10 and 1000),
  original_status public.invoice_status_enum not null,
  original_paid_at timestamptz,
  original_total numeric not null,
  original_currency text not null,
  original_updated_at timestamptz not null,
  request jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.legacy_payment_reviews enable row level security;
revoke all on public.legacy_payment_reviews from public,anon,authenticated;
grant select on public.legacy_payment_reviews to authenticated;
create policy "Read visible legacy review" on public.legacy_payment_reviews for select to authenticated
using(exists(select 1 from public.invoices i where i.id=invoice_id));
alter table public.invoice_events drop constraint invoice_events_action_check;
alter table public.invoice_events add constraint invoice_events_action_check
check(action in ('created','updated','issued','payment_recorded','payment_reversed','time_reserved','cancelled','legacy_reviewed'));

create function amountly_private.review_legacy_payment(p_id uuid,p_invoice_id uuid,p_expected_updated_at timestamptz,p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.invoices; prior public.legacy_payment_reviews; field record;
begin
  select * into i from public.invoices where id=p_invoice_id for update;
  if i.id is null or not amountly_private.active_actor()
    or not public.can_access_financial_record(i.organization_id,i.user_id,'invoice','write') then
    raise exception 'Not permitted' using errcode='42501'; end if;
  if p_id is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>6000 then
    raise exception 'Invalid review' using errcode='22023'; end if;
  select * into prior from public.legacy_payment_reviews where id=p_id;
  if found then
    if prior.invoice_id=p_invoice_id and prior.recorded_by=auth.uid() and prior.request=p_data
      and prior.original_updated_at=p_expected_updated_at then return p_id; end if;
    raise exception 'Request changed' using errcode='22023'; end if;
  if i.updated_at is distinct from p_expected_updated_at then raise exception 'Invoice changed' using errcode='PT409'; end if;
  if i.status<>'PAID' or exists(select 1 from public.invoice_payments where invoice_id=i.id)
    or exists(select 1 from public.legacy_payment_reviews where invoice_id=i.id) then
    raise exception 'Invoice is not awaiting legacy review' using errcode='22023'; end if;
  if coalesce(p_data->>'action','') not in ('record_payment','reopen')
    or length(btrim(coalesce(p_data->>'evidence',''))) not between 10 and 1000
    or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('action','evidence','amount','paid_on','method','reference')) then
    raise exception 'Invalid review details' using errcode='22023'; end if;
  for field in select key,value from jsonb_each(p_data) where key<>'amount' loop
    if jsonb_typeof(field.value) is distinct from 'string' then raise exception 'Invalid review field' using errcode='22023'; end if;
  end loop;
  if p_data->>'action'='reopen' and p_data ?| array['amount','paid_on','method','reference'] then
    raise exception 'Reopening does not record a payment' using errcode='22023'; end if;
  if p_data->>'action'='record_payment' and (jsonb_typeof(p_data->'amount') is distinct from 'number'
    or coalesce(p_data->>'paid_on','') !~ '^\d{4}-\d{2}-\d{2}$') then
    raise exception 'Enter payment evidence' using errcode='22023'; end if;
  insert into public.legacy_payment_reviews(id,invoice_id,recorded_by,action,evidence,original_status,original_paid_at,original_total,original_currency,original_updated_at,request)
    values(p_id,i.id,auth.uid(),p_data->>'action',btrim(p_data->>'evidence'),i.status,i.paid_at,i.total,i.currency,i.updated_at,p_data);
  -- Preserve the old flag/date above; normal payment validation calculates the
  -- new balance. Partial historical evidence leaves the remainder outstanding.
  update public.invoices set status='SENT',paid_at=null where id=i.id;
  if p_data->>'action'='record_payment' then
    perform amountly_private.record_invoice_payment(p_id,i.id,(p_data->>'amount')::numeric,(p_data->>'paid_on')::date,p_data->>'method',p_data->>'reference');
  end if;
  insert into public.invoice_events(invoice_id,actor_id,action) values(i.id,auth.uid(),'legacy_reviewed');
  return p_id;
end $$;
create function public.review_legacy_payment(p_id uuid,p_invoice_id uuid,p_expected_updated_at timestamptz,p_data jsonb)
returns uuid language sql security invoker set search_path='' as $$select amountly_private.review_legacy_payment(p_id,p_invoice_id,p_expected_updated_at,p_data)$$;
revoke all on function amountly_private.review_legacy_payment(uuid,uuid,timestamptz,jsonb),public.review_legacy_payment(uuid,uuid,timestamptz,jsonb) from public,anon;
grant execute on function amountly_private.review_legacy_payment(uuid,uuid,timestamptz,jsonb),public.review_legacy_payment(uuid,uuid,timestamptz,jsonb) to authenticated;
