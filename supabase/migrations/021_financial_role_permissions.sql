-- Restrictive policies intersect existing ownership policies, so older permissive
-- policies cannot bypass the role boundary. Existing data is not rewritten.
create function public.can_access_financial_record(
  record_org uuid, record_user uuid, resource text, operation text
)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare actor public.users;
begin
  if resource is null or operation is null or resource not in ('invoice', 'client', 'project', 'task')
    or operation not in ('read', 'create', 'write', 'send') then return false; end if;
  select * into actor from public.users where id = auth.uid() and is_active is true;
  if actor.id is null then return false; end if;
  if actor.account_type = 'freelancer' then
    return record_org is null and record_user = actor.id;
  end if;
  if actor.account_type <> 'business' or record_org is null
    or record_user is not null or record_org is distinct from actor.organization_id then
    return false;
  end if;
  if actor.role in ('OWNER', 'ADMIN') then return true; end if;
  if resource = 'invoice' then
    return actor.role = 'CONTRACTOR' and operation in ('read', 'create', 'send');
  end if;
  return operation = 'read' and actor.role in ('MEMBER', 'CONTRACTOR');
end;
$$;
revoke all on function public.can_access_financial_record(uuid, uuid, text, text) from public, anon;
grant execute on function public.can_access_financial_record(uuid, uuid, text, text) to authenticated;

-- Aggregate RPCs must respect the same invoice read policies as direct queries.
alter function public.get_dashboard_metrics(uuid) security invoker;
alter function public.get_business_metrics(uuid) security invoker;

create policy "Invoice role read" on public.invoices as restrictive for select to authenticated
  using (public.can_access_financial_record(organization_id, user_id, 'invoice', 'read'));
create policy "Invoice role create" on public.invoices as restrictive for insert to authenticated
  with check (
    public.can_access_financial_record(organization_id, user_id, 'invoice', 'create')
    and (status = 'DRAFT' or public.can_access_financial_record(organization_id, user_id, 'invoice', 'write'))
  );
create policy "Invoice role update" on public.invoices as restrictive for update to authenticated
  using (
    public.can_access_financial_record(organization_id, user_id, 'invoice', 'write')
    or (status = 'DRAFT' and public.can_access_financial_record(organization_id, user_id, 'invoice', 'send'))
  ) with check (
    public.can_access_financial_record(organization_id, user_id, 'invoice', 'write')
    or (status = 'SENT' and public.can_access_financial_record(organization_id, user_id, 'invoice', 'send'))
  );
create policy "Invoice role delete" on public.invoices as restrictive for delete to authenticated
  using (public.can_access_financial_record(organization_id, user_id, 'invoice', 'write'));

-- A send-only user cannot smuggle header edits into a DRAFT -> SENT update.
-- Foreign keys must belong to the same ownership boundary, not merely exist.
create function public.enforce_invoice_write_boundary()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id or new.user_id is distinct from old.user_id then
      raise exception 'Invoice ownership cannot be changed' using errcode = '42501';
    end if;
    if current_user = 'authenticated'
      and not public.can_access_financial_record(old.organization_id, old.user_id, 'invoice', 'write') then
      if old.status <> 'DRAFT' or new.status <> 'SENT'
        or (to_jsonb(new) - array['status', 'updated_at']) is distinct from
           (to_jsonb(old) - array['status', 'updated_at']) then
        raise exception 'Invoice changes are not permitted' using errcode = '42501';
      end if;
    end if;
  end if;
  if new.client_id is not null and not exists (
    select 1 from public.clients c where c.id = new.client_id
      and c.organization_id is not distinct from new.organization_id
      and c.user_id is not distinct from new.user_id
  ) then raise exception 'Client is not in the invoice workspace' using errcode = '42501'; end if;
  if new.project_id is not null and not exists (
    select 1 from public.projects p where p.id = new.project_id
      and p.organization_id is not distinct from new.organization_id
      and p.user_id is not distinct from new.user_id
  ) then raise exception 'Project is not in the invoice workspace' using errcode = '42501'; end if;
  return new;
end;
$$;
create trigger enforce_invoice_write_boundary before insert or update on public.invoices
  for each row execute function public.enforce_invoice_write_boundary();

create policy "Invoice lines role read" on public.invoice_line_items as restrictive for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id
    and public.can_access_financial_record(i.organization_id, i.user_id, 'invoice', 'read')));
create policy "Invoice lines role create" on public.invoice_line_items as restrictive for insert to authenticated
  with check (exists (select 1 from public.invoices i where i.id = invoice_id and (
    public.can_access_financial_record(i.organization_id, i.user_id, 'invoice', 'write')
    or (i.status = 'DRAFT' and public.can_access_financial_record(i.organization_id, i.user_id, 'invoice', 'create'))
  )));
create policy "Invoice lines role update" on public.invoice_line_items as restrictive for update to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id
    and public.can_access_financial_record(i.organization_id, i.user_id, 'invoice', 'write')))
  with check (exists (select 1 from public.invoices i where i.id = invoice_id
    and public.can_access_financial_record(i.organization_id, i.user_id, 'invoice', 'write')));
create policy "Invoice lines role delete" on public.invoice_line_items as restrictive for delete to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id
    and public.can_access_financial_record(i.organization_id, i.user_id, 'invoice', 'write')));

create policy "Client role read" on public.clients as restrictive for select to authenticated
  using (public.can_access_financial_record(organization_id, user_id, 'client', 'read'));
create policy "Client role create" on public.clients as restrictive for insert to authenticated
  with check (public.can_access_financial_record(organization_id, user_id, 'client', 'create'));
create policy "Client role update" on public.clients as restrictive for update to authenticated
  using (public.can_access_financial_record(organization_id, user_id, 'client', 'write'))
  with check (public.can_access_financial_record(organization_id, user_id, 'client', 'write'));
create policy "Client role delete" on public.clients as restrictive for delete to authenticated
  using (public.can_access_financial_record(organization_id, user_id, 'client', 'write'));

create policy "Project role read" on public.projects as restrictive for select to authenticated
  using (public.can_access_financial_record(organization_id, user_id, 'project', 'read'));
create policy "Project role create" on public.projects as restrictive for insert to authenticated
  with check (public.can_access_financial_record(organization_id, user_id, 'project', 'create'));
create policy "Project role update" on public.projects as restrictive for update to authenticated
  using (public.can_access_financial_record(organization_id, user_id, 'project', 'write'))
  with check (public.can_access_financial_record(organization_id, user_id, 'project', 'write'));
create policy "Project role delete" on public.projects as restrictive for delete to authenticated
  using (public.can_access_financial_record(organization_id, user_id, 'project', 'write'));

-- Tasks inherit project ownership, including freelancer-owned projects.
create policy "Scoped task access" on public.tasks for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id))
  with check (exists (select 1 from public.projects p where p.id = project_id));
create policy "Task role read" on public.tasks as restrictive for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id
    and public.can_access_financial_record(p.organization_id, p.user_id, 'task', 'read')));
create policy "Task role create" on public.tasks as restrictive for insert to authenticated
  with check (exists (select 1 from public.projects p where p.id = project_id
    and public.can_access_financial_record(p.organization_id, p.user_id, 'task', 'create')));
create policy "Task role update" on public.tasks as restrictive for update to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id
    and public.can_access_financial_record(p.organization_id, p.user_id, 'task', 'write')))
  with check (exists (select 1 from public.projects p where p.id = project_id
    and public.can_access_financial_record(p.organization_id, p.user_id, 'task', 'write')));
create policy "Task role delete" on public.tasks as restrictive for delete to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id
    and public.can_access_financial_record(p.organization_id, p.user_id, 'task', 'write')));
