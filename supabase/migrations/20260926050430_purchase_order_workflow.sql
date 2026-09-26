-- Historical orders had no currency column. Leave it unknown instead of
-- inventing a denomination; new orders must specify a supported currency.
alter table public.purchase_orders add column currency text;
alter table public.record_events drop constraint record_events_record_type_check;
alter table public.record_events add constraint record_events_record_type_check check(record_type in ('expenses','time_entries','bills','vendor_bills','purchase_orders'));
create policy "Read purchase order history" on public.record_events for select to authenticated
using(record_type='purchase_orders' and exists(select 1 from public.purchase_orders p where p.id=record_id));
alter table amountly_private.capture_requests drop constraint capture_requests_kind_check;
alter table amountly_private.capture_requests add constraint capture_requests_kind_check check(kind in ('bills','expenses','vendor_bills','purchase_orders'));
create trigger purchase_orders_updated_at before update on public.purchase_orders for each row execute function public.update_updated_at_column();
create trigger record_change after insert or update on public.purchase_orders for each row execute function amountly_private.record_change();
revoke insert,update,delete on public.purchase_orders,public.purchase_order_line_items from anon,authenticated;

create function amountly_private.can_manage_purchase_order(record_org uuid,record_user uuid,record_vendor uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select amountly_private.active_actor() and exists(select 1 from public.users u join public.vendors v on v.id=record_vendor
    where u.id=auth.uid() and u.id=record_user and v.user_id=u.id
      and (record_org is null or record_org=u.organization_id)
      and (v.organization_id is null or v.organization_id=u.organization_id)
      and (u.account_type='freelancer' or (u.account_type='business' and u.role in ('OWNER','ADMIN'))))
$$;
revoke all on function amountly_private.can_manage_purchase_order(uuid,uuid,uuid) from public,anon;
grant execute on function amountly_private.can_manage_purchase_order(uuid,uuid,uuid) to authenticated;
create policy "Purchase order manager scope" on public.purchase_orders as restrictive for select to authenticated
using(amountly_private.can_manage_purchase_order(organization_id,user_id,vendor_id));
create policy "Purchase line parent scope" on public.purchase_order_line_items as restrictive for select to authenticated
using(exists(select 1 from public.purchase_orders p where p.id=purchase_order_id));

create function amountly_private.save_purchase_order(p_id uuid,p_data jsonb,p_lines jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor public.users; vendor public.vendors; prior amountly_private.capture_requests;
  item jsonb; qty numeric; rate numeric; subtotal numeric:=0; tax numeric; total_value numeric; line_index integer:=0;
begin
  select * into actor from public.users where id=auth.uid() and is_active;
  if actor.id is null or not amountly_private.active_actor() or actor.account_type not in ('business','freelancer')
    or (actor.account_type='business' and actor.role not in ('OWNER','ADMIN')) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_id is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>16000
    or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 100 or octet_length(p_lines::text)>150000 then
    raise exception 'Invalid purchase order' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('purchase_orders'||p_id::text,4));
  select * into prior from amountly_private.capture_requests where kind='purchase_orders' and request_id=p_id;
  if found then
    if prior.actor_id is distinct from actor.id then raise exception 'Not permitted' using errcode='42501'; end if;
    if prior.payload is distinct from jsonb_build_object('data',p_data,'lines',p_lines) then raise exception 'Request changed' using errcode='22023'; end if;
    return p_id;
  end if;
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('vendor_id','po_number','date','expected_date','tax_rate','currency','notes'))
    or exists(select 1 from jsonb_each(p_data) where key<>'tax_rate' and jsonb_typeof(value) not in ('string','null'))
    or jsonb_typeof(p_data->'tax_rate') is distinct from 'number' then raise exception 'Invalid fields' using errcode='22023'; end if;
  select * into vendor from public.vendors where id=(p_data->>'vendor_id')::uuid for share;
  if vendor.id is null or not amountly_private.can_manage_purchase_order(actor.organization_id,actor.id,vendor.id) then raise exception 'Not permitted' using errcode='42501'; end if;
  if vendor.archived_at is not null then raise exception 'Vendor archived' using errcode='22023'; end if;
  if length(btrim(coalesce(p_data->>'po_number',''))) not between 1 and 64
    or coalesce(p_data->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' or (p_data->>'date')::date not between date '2000-01-01' and date '2100-12-31'
    or (p_data->>'expected_date' is not null and (p_data->>'expected_date' !~ '^\d{4}-\d{2}-\d{2}$'
      or (p_data->>'expected_date')::date not between (p_data->>'date')::date and date '2100-12-31'))
    or coalesce(p_data->>'currency','') not in ('USD','EUR','GBP','CAD','AUD') or length(coalesce(p_data->>'notes',''))>5000 then
    raise exception 'Invalid purchase order fields' using errcode='22023'; end if;
  tax:=(p_data->>'tax_rate')::numeric;
  if tax not between 0 and 100 or tax<>round(tax,2) then raise exception 'Invalid tax rate' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('description','quantity','rate'))
      or jsonb_typeof(item->'description') is distinct from 'string' or length(btrim(item->>'description')) not between 1 and 1000
      or jsonb_typeof(item->'quantity') is distinct from 'number' or jsonb_typeof(item->'rate') is distinct from 'number' then
      raise exception 'Invalid line' using errcode='22023'; end if;
    qty:=(item->>'quantity')::numeric;rate:=(item->>'rate')::numeric;
    if qty not between 0.01 and 100000 or rate not between 0 and 999999 or qty<>round(qty,2) or rate<>round(rate,2) then
      raise exception 'Invalid line amount' using errcode='22023'; end if;
    subtotal:=subtotal+round(qty*rate,2);
  end loop;
  total_value:=subtotal+round(subtotal*tax/100,2);
  if total_value<=0 or total_value>=100000000 then raise exception 'Invalid total' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(vendor.id::text||lower(btrim(p_data->>'po_number')),5));
  if exists(select 1 from public.purchase_orders where vendor_id=vendor.id and lower(btrim(po_number))=lower(btrim(p_data->>'po_number')) and status<>'cancelled') then
    raise exception 'Possible duplicate order' using errcode='PT409'; end if;
  insert into public.purchase_orders(id,user_id,organization_id,vendor_id,po_number,date,expected_date,subtotal,tax_rate,tax_amount,total,currency,notes)
    values(p_id,actor.id,actor.organization_id,vendor.id,btrim(p_data->>'po_number'),(p_data->>'date')::date,(p_data->>'expected_date')::date,
      subtotal,tax,round(subtotal*tax/100,2),total_value,p_data->>'currency',p_data->>'notes');
  for item in select value from jsonb_array_elements(p_lines) loop
    insert into public.purchase_order_line_items(purchase_order_id,description,quantity,rate,amount,"order")
      values(p_id,btrim(item->>'description'),(item->>'quantity')::numeric,(item->>'rate')::numeric,round((item->>'quantity')::numeric*(item->>'rate')::numeric,2),line_index);
    line_index:=line_index+1;
  end loop;
  insert into amountly_private.capture_requests(kind,request_id,actor_id,payload)
    values('purchase_orders',p_id,actor.id,jsonb_build_object('data',p_data,'lines',p_lines));
  return p_id;
end $$;

create function amountly_private.purchase_order_action(p_id uuid,p_action text,p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare p public.purchase_orders; next_status text;
begin
  select * into p from public.purchase_orders where id=p_id for update;
  if p.id is null or not amountly_private.can_manage_purchase_order(p.organization_id,p.user_id,p.vendor_id) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p.updated_at is distinct from p_expected_updated_at then raise exception 'Order changed' using errcode='PT409'; end if;
  if p_action='send' and p.status='draft' and p.currency is not null then next_status:='sent';
  elsif p_action='receive' and p.status='sent' and p.currency is not null then next_status:='received';
  elsif p_action='cancel' and p.status in ('draft','sent') then next_status:='cancelled';
  else raise exception 'Invalid order transition' using errcode='22023'; end if;
  update public.purchase_orders set status=next_status where id=p_id;
end $$;
create function public.save_purchase_order(p_id uuid,p_data jsonb,p_lines jsonb) returns uuid
language sql security invoker set search_path='' as $$select amountly_private.save_purchase_order(p_id,p_data,p_lines)$$;
create function public.purchase_order_action(p_id uuid,p_action text,p_expected_updated_at timestamptz) returns void
language sql security invoker set search_path='' as $$select amountly_private.purchase_order_action(p_id,p_action,p_expected_updated_at)$$;
revoke all on function amountly_private.save_purchase_order(uuid,jsonb,jsonb),public.save_purchase_order(uuid,jsonb,jsonb),amountly_private.purchase_order_action(uuid,text,timestamptz),public.purchase_order_action(uuid,text,timestamptz) from public,anon;
grant execute on function amountly_private.save_purchase_order(uuid,jsonb,jsonb),public.save_purchase_order(uuid,jsonb,jsonb),amountly_private.purchase_order_action(uuid,text,timestamptz),public.purchase_order_action(uuid,text,timestamptz) to authenticated;
