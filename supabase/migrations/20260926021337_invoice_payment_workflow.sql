-- Payments are immutable events. Existing PAID invoices keep their legacy state;
-- no synthetic cash receipts or dates are fabricated during migration.
alter table public.invoices add column issued_snapshot jsonb;
alter table public.invoices add column workflow_version integer not null default 0;
alter table public.invoices drop constraint invoices_invoice_number_key;
create unique index invoices_workspace_number on public.invoices (coalesce(organization_id, user_id), invoice_number);
create table amountly_private.invoice_counters (workspace_id uuid primary key, last_number bigint not null);
revoke all on amountly_private.invoice_counters from public, anon, authenticated;

create table public.invoice_payments (
  id uuid primary key,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount numeric(10,2) not null check (amount > 0 and amount < 100000000),
  paid_on date not null,
  method text not null check (method in ('bank_transfer','card','cash','check','other')),
  reference text not null default '' check (length(reference) <= 200),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index invoice_payments_invoice_id on public.invoice_payments(invoice_id);
create table public.invoice_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('created','updated','issued','payment_recorded','cancelled')),
  created_at timestamptz not null default now()
);
create index invoice_events_invoice_id on public.invoice_events(invoice_id);
alter table public.invoice_payments enable row level security;
alter table public.invoice_events enable row level security;
revoke all on public.invoice_payments, public.invoice_events from public, anon, authenticated;
grant select on public.invoice_payments, public.invoice_events to authenticated;
create policy "Read scoped payments" on public.invoice_payments for select to authenticated
using (exists (select 1 from public.invoices i where i.id = invoice_id));
create policy "Read scoped invoice events" on public.invoice_events for select to authenticated
using (exists (select 1 from public.invoices i where i.id = invoice_id));

-- Browser writes must go through commands. Definer commands below explicitly
-- authorize the actor and lock the parent row before changing money or state.
create function amountly_private.invoice_command_only() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('authenticated','anon') then
    raise exception 'Use the invoice workflow' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    if tg_table_name = 'invoices' then
      if old.status <> 'DRAFT' then raise exception 'Issued invoices must be preserved' using errcode='42501'; end if;
    end if;
    return old;
  end if;
  return new;
end $$;
create trigger invoice_command_only before insert or update or delete on public.invoices
for each row execute function amountly_private.invoice_command_only();
create trigger invoice_lines_command_only before insert or update or delete on public.invoice_line_items
for each row execute function amountly_private.invoice_command_only();

create function amountly_private.save_invoice(p_id uuid, p_data jsonb, p_lines jsonb, p_expected_updated_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor public.users; existing public.invoices; saved_id uuid; item jsonb;
  v_org uuid; v_user uuid; v_client uuid; v_project uuid;
  v_number text; v_seq bigint; v_quantity numeric; v_rate numeric;
  v_subtotal numeric := 0; v_tax numeric; v_tax_amount numeric;
  v_issue date; v_due date; v_currency text; v_index integer := 0;
begin
  select * into actor from public.users where id = auth.uid() and is_active is true;
  if actor.id is null or p_id is null then raise exception 'Not permitted' using errcode='42501'; end if;
  v_org := case when actor.account_type = 'business' then actor.organization_id else null end;
  v_user := case when actor.account_type = 'business' then null else actor.id end;
  select * into existing from public.invoices where id = p_id for update;
  if existing.id is not null then
    if not public.can_access_financial_record(existing.organization_id, existing.user_id, 'invoice','write') then
      raise exception 'Not permitted' using errcode='42501';
    end if;
    if existing.status <> 'DRAFT' then raise exception 'Only drafts can be edited' using errcode='22023'; end if;
    if p_expected_updated_at is distinct from existing.updated_at then
      raise exception 'Invoice changed. Reload before saving.' using errcode='40001';
    end if;
    v_org := existing.organization_id; v_user := existing.user_id;
  elsif not public.can_access_financial_record(v_org, v_user, 'invoice','create') then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text) > 16000
    or exists (select 1 from jsonb_object_keys(p_data) k where k not in ('client_id','project_id','invoice_number','issue_date','due_date','tax_rate','currency','notes'))
    or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 100 then
    raise exception 'Invalid invoice fields' using errcode='22023';
  end if;
  v_client := (p_data->>'client_id')::uuid; v_project := nullif(p_data->>'project_id','')::uuid;
  if v_client is null or not exists (select 1 from public.clients c where c.id = v_client
    and c.organization_id is not distinct from v_org and c.user_id is not distinct from v_user and c.archived_at is null) then
    raise exception 'Choose an active client in this workspace' using errcode='42501';
  end if;
  if v_project is not null and not exists (select 1 from public.projects p where p.id = v_project
    and p.organization_id is not distinct from v_org and p.user_id is not distinct from v_user
    and (p.client_id is null or p.client_id = v_client) and p.archived_at is null) then
    raise exception 'Choose a project in this workspace for this client' using errcode='42501';
  end if;
  if coalesce(p_data->>'issue_date','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_data->>'due_date','') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Invalid invoice dates' using errcode='22023';
  end if;
  v_issue := (p_data->>'issue_date')::date; v_due := (p_data->>'due_date')::date;
  v_tax := coalesce((p_data->>'tax_rate')::numeric,0); v_currency := p_data->>'currency';
  if v_due < v_issue or v_issue < date '2000-01-01' or v_due > date '2100-12-31'
    or v_tax not between 0 and 100 or v_tax <> round(v_tax,2)
    or v_currency is null or v_currency not in ('USD','EUR','GBP','CAD','AUD')
    or jsonb_typeof(p_data->'notes') not in ('string','null')
    or length(coalesce(p_data->>'notes','')) > 5000 then
    raise exception 'Invalid invoice values' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(item) is distinct from 'object' or exists (select 1 from jsonb_object_keys(item) k where k not in ('description','quantity','rate'))
      or jsonb_typeof(item->'description') is distinct from 'string'
      or length(btrim(coalesce(item->>'description',''))) not between 1 and 1000
      or jsonb_typeof(item->'quantity') is distinct from 'number' or jsonb_typeof(item->'rate') is distinct from 'number' then
      raise exception 'Invalid invoice line' using errcode='22023';
    end if;
    v_quantity := (item->>'quantity')::numeric; v_rate := (item->>'rate')::numeric;
    if v_quantity not between 0.01 and 100000 or v_rate not between 0 and 999999
      or v_quantity <> round(v_quantity,2) or v_rate <> round(v_rate,2) then
      raise exception 'Invalid quantity or rate' using errcode='22023';
    end if;
    v_subtotal := v_subtotal + round(v_quantity * v_rate,2);
  end loop;
  v_tax_amount := round(v_subtotal * v_tax / 100,2);
  if v_subtotal <= 0 or v_subtotal + v_tax_amount >= 100000000 then
    raise exception 'Invoice total must be positive and within supported limits' using errcode='22023';
  end if;
  v_number := nullif(btrim(p_data->>'invoice_number'),'');
  if v_number is not null and (length(v_number) > 64 or v_number !~ '^[A-Za-z0-9][A-Za-z0-9 /_-]*$') then
    raise exception 'Invalid invoice number' using errcode='22023';
  end if;
  if existing.id is null then
    if v_number is null then
      loop
        insert into amountly_private.invoice_counters values (coalesce(v_org,v_user),1)
        on conflict (workspace_id) do update set last_number = amountly_private.invoice_counters.last_number + 1 returning last_number into v_seq;
        v_number := 'INV-' || lpad(v_seq::text, greatest(4,length(v_seq::text)), '0');
        exit when not exists (select 1 from public.invoices where coalesce(organization_id,user_id) = coalesce(v_org,v_user) and invoice_number=v_number);
      end loop;
    end if;
    insert into public.invoices (id,organization_id,user_id,client_id,project_id,invoice_number,issue_date,due_date,subtotal,tax_rate,tax_amount,total,currency,notes,workflow_version)
    values (p_id,v_org,v_user,v_client,v_project,v_number,v_issue,v_due,v_subtotal,v_tax,v_tax_amount,v_subtotal+v_tax_amount,v_currency,p_data->>'notes',1)
    returning id into saved_id;
  else
    update public.invoices set client_id=v_client, project_id=v_project, invoice_number=coalesce(v_number,existing.invoice_number),
      issue_date=v_issue,due_date=v_due,subtotal=v_subtotal,tax_rate=v_tax,tax_amount=v_tax_amount,total=v_subtotal+v_tax_amount,
      currency=v_currency,notes=p_data->>'notes',workflow_version=1 where id=p_id returning id into saved_id;
    delete from public.invoice_line_items where invoice_id=p_id;
  end if;
  for item in select value from jsonb_array_elements(p_lines) loop
    insert into public.invoice_line_items (invoice_id,description,quantity,rate,amount,"order")
    values (saved_id,btrim(item->>'description'),(item->>'quantity')::numeric,(item->>'rate')::numeric,
      round((item->>'quantity')::numeric*(item->>'rate')::numeric,2),v_index);
    v_index := v_index + 1;
  end loop;
  insert into public.invoice_events(invoice_id,actor_id,action) values(saved_id,actor.id,case when existing.id is null then 'created' else 'updated' end);
  return saved_id;
end $$;

create function amountly_private.invoice_action(p_id uuid, p_action text, p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.invoices; v_sum numeric;
begin
  select * into i from public.invoices where id=p_id for update;
  if i.id is null or not public.can_access_financial_record(i.organization_id,i.user_id,'invoice',case when p_action='issue' then 'send' else 'write' end) then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  if p_expected_updated_at is distinct from i.updated_at then raise exception 'Invoice changed. Reload first.' using errcode='40001'; end if;
  if p_action='issue' and i.status='DRAFT' then
    select sum(amount) into v_sum from public.invoice_line_items where invoice_id=p_id;
    if v_sum is null or v_sum <= 0 or v_sum <> i.subtotal or i.total <> i.subtotal + coalesce(i.tax_amount,0)
      or i.tax_rate not between 0 and 100
      or i.client_id is null or exists(select 1 from public.invoice_line_items where invoice_id=p_id and (quantity <= 0 or rate < 0 or amount <> round(quantity*rate,2)))
      or coalesce(i.tax_amount,0) <> round(i.subtotal*coalesce(i.tax_rate,0)/100,2) or i.due_date < i.issue_date then
      raise exception 'Review and save this draft before issuing' using errcode='22023';
    end if;
    update public.invoices set status='SENT',workflow_version=1,issued_snapshot=jsonb_build_object(
      'client',(select jsonb_build_object('name',name,'email',email,'address',address) from public.clients where id=i.client_id),
      'lines',(select jsonb_agg(to_jsonb(l) order by l."order") from public.invoice_line_items l where invoice_id=p_id),
      'issued_at',now()) where id=p_id;
    insert into public.invoice_events(invoice_id,actor_id,action) values(p_id,auth.uid(),'issued');
  elsif p_action='delete' and i.status='DRAFT' then
    delete from public.invoices where id=p_id;
  elsif p_action='cancel' and i.status in ('SENT','OVERDUE') and not exists(select 1 from public.invoice_payments where invoice_id=p_id) then
    update public.invoices set status='CANCELLED' where id=p_id;
    insert into public.invoice_events(invoice_id,actor_id,action) values(p_id,auth.uid(),'cancelled');
  else raise exception 'This action is not allowed for the current invoice state' using errcode='22023'; end if;
end $$;

create function amountly_private.record_invoice_payment(p_id uuid, p_invoice_id uuid, p_amount numeric, p_paid_on date, p_method text, p_reference text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.invoices; prior public.invoice_payments; v_paid numeric;
begin
  select * into i from public.invoices where id=p_invoice_id for update;
  if i.id is null or not public.can_access_financial_record(i.organization_id,i.user_id,'invoice','write') then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  select * into prior from public.invoice_payments where id=p_id;
  if prior.id is not null then
    if prior.invoice_id=p_invoice_id and prior.amount=p_amount and prior.paid_on=p_paid_on
      and prior.method=p_method and prior.reference=coalesce(p_reference,'') and prior.recorded_by=auth.uid() then return prior.id; end if;
    raise exception 'Payment request already used' using errcode='22023';
  end if;
  if p_id is null or p_amount is null or p_amount <= 0 or p_amount >= 100000000 or p_amount <> round(p_amount,2)
    or p_paid_on is null or p_paid_on > current_date or p_paid_on < i.issue_date::date
    or p_method is null or p_method not in ('bank_transfer','card','cash','check','other')
    or length(coalesce(p_reference,'')) > 200 then raise exception 'Invalid payment details' using errcode='22023'; end if;
  if i.status not in ('SENT','OVERDUE') then raise exception 'Only outstanding issued invoices accept payments' using errcode='22023'; end if;
  select coalesce(sum(amount),0) into v_paid from public.invoice_payments where invoice_id=p_invoice_id;
  if p_amount > i.total-v_paid then raise exception 'Payment exceeds the outstanding balance' using errcode='22023'; end if;
  insert into public.invoice_payments(id,invoice_id,amount,paid_on,method,reference,recorded_by)
    values(p_id,p_invoice_id,p_amount,p_paid_on,p_method,coalesce(p_reference,''),auth.uid());
  update public.invoices set status=case when v_paid+p_amount=total then 'PAID'::public.invoice_status_enum else status end,
    paid_at=case when v_paid+p_amount=total then (select max(paid_on)::timestamptz from public.invoice_payments where invoice_id=p_invoice_id) else null end
    where id=p_invoice_id;
  insert into public.invoice_events(invoice_id,actor_id,action) values(p_invoice_id,auth.uid(),'payment_recorded');
  return p_id;
end $$;

-- Public API facades run as caller; privileged implementations stay unexposed.
create function public.save_invoice(p_id uuid,p_data jsonb,p_lines jsonb,p_expected_updated_at timestamptz default null)
returns uuid language sql security invoker set search_path='' as $$ select amountly_private.save_invoice(p_id,p_data,p_lines,p_expected_updated_at) $$;
create function public.invoice_action(p_id uuid,p_action text,p_expected_updated_at timestamptz)
returns void language sql security invoker set search_path='' as $$ select amountly_private.invoice_action(p_id,p_action,p_expected_updated_at) $$;
create function public.record_invoice_payment(p_id uuid,p_invoice_id uuid,p_amount numeric,p_paid_on date,p_method text,p_reference text default '')
returns uuid language sql security invoker set search_path='' as $$ select amountly_private.record_invoice_payment(p_id,p_invoice_id,p_amount,p_paid_on,p_method,p_reference) $$;
revoke all on function amountly_private.save_invoice(uuid,jsonb,jsonb,timestamptz), amountly_private.invoice_action(uuid,text,timestamptz), amountly_private.record_invoice_payment(uuid,uuid,numeric,date,text,text), public.save_invoice(uuid,jsonb,jsonb,timestamptz), public.invoice_action(uuid,text,timestamptz), public.record_invoice_payment(uuid,uuid,numeric,date,text,text) from public,anon;
grant execute on function amountly_private.save_invoice(uuid,jsonb,jsonb,timestamptz), amountly_private.invoice_action(uuid,text,timestamptz), amountly_private.record_invoice_payment(uuid,uuid,numeric,date,text,text), public.save_invoice(uuid,jsonb,jsonb,timestamptz), public.invoice_action(uuid,text,timestamptz), public.record_invoice_payment(uuid,uuid,numeric,date,text,text) to authenticated;
revoke all on all functions in schema amountly_private from public, anon;
