-- Deferred modules retain historical reads and exports, but browser roles cannot
-- mutate them until their posting/payroll/inventory commands have been audited.
-- An environment flag must never serve as the authorization boundary.
create function amountly_private.manages_workspace(record_org uuid, record_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.users u join public.workspace_memberships m on m.user_id=u.id
    where u.id=auth.uid() and u.is_active and m.is_active and
      ((u.account_type='business' and u.role in ('OWNER','ADMIN') and record_org=u.organization_id
        and (record_user is null or record_user=u.id))
       or (u.account_type='freelancer' and record_org is null and record_user=u.id)))
$$;
revoke all on function amountly_private.manages_workspace(uuid,uuid) from public,anon;
grant execute on function amountly_private.manages_workspace(uuid,uuid) to authenticated;
do $$ declare t text; begin
  foreach t in array array['accounts','journal_entries','employees','payroll_runs','inventory_items'] loop
    execute format('create policy "Deferred module manager read" on public.%I as restrictive for select to authenticated using (amountly_private.manages_workspace(organization_id,user_id))',t);
  end loop;
  foreach t in array array['accounts','journal_entries','journal_entry_lines','employees','payroll_runs','pay_stubs','inventory_items'] loop
    execute format('revoke insert,update,delete,truncate,references,trigger on public.%I from public,anon,authenticated',t);
  end loop;
end $$;
create policy "Journal line parents agree" on public.journal_entry_lines as restrictive for select to authenticated
using(exists(select 1 from public.journal_entries j join public.accounts a on a.id=account_id
  where j.id=journal_entry_id and a.organization_id is not distinct from j.organization_id and a.user_id is not distinct from j.user_id));
create policy "Pay stub parents agree" on public.pay_stubs as restrictive for select to authenticated
using(exists(select 1 from public.payroll_runs p join public.employees e on e.id=employee_id
  where p.id=payroll_run_id and e.organization_id is not distinct from p.organization_id
    and e.user_id is not distinct from p.user_id));
create policy "Inventory supplier agrees" on public.inventory_items as restrictive for select to authenticated
using(supplier_id is null or exists(select 1 from public.vendors v where v.id=supplier_id
  and v.organization_id is not distinct from inventory_items.organization_id and v.user_id is not distinct from inventory_items.user_id));
