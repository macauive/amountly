-- Catalog inventory only: no application rows, credentials or function bodies.
-- Run with ON_ERROR_STOP enabled in a dedicated connection. This is NOT a
-- migration, a backup, a write gate, or proof of safe historical data.
begin isolation level repeatable read read only;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '30s';

select current_setting('server_version_num') as server_version_num,
       current_setting('transaction_read_only') as transaction_read_only;

-- These catalog lookups also work before the new workflow objects exist.
with expected(relation, column_name) as (values
  ('public.organizations', 'owner_id'),
  ('public.users', 'preferences'),
  ('public.invoices', 'workflow_version'),
  ('public.invoices', 'issued_snapshot'),
  ('public.expenses', 'archived_at'),
  ('public.workspaces', 'id'),
  ('public.workspace_memberships', 'workspace_id'),
  ('public.invoice_payments', 'id'),
  ('public.invoice_payment_reversals', 'id'),
  ('amountly_private.capture_requests', 'request_id')
)
select e.relation, e.column_name,
       c.oid is not null as relation_exists,
       a.attnum is not null as column_exists
from expected e
left join pg_class c on c.oid = to_regclass(e.relation)
left join pg_attribute a on a.attrelid = c.oid and a.attname = e.column_name
  and a.attnum > 0 and not a.attisdropped
order by e.relation, e.column_name;

-- Privileges alone are not authorization: policies, triggers, and RPC bodies
-- still need review and role tests. Column-specific grants need separate review.
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policy_count,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
       has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE') as anon_write,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select,
       has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE') as authenticated_write
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'amountly_private') and c.relkind in ('r', 'p')
order by n.nspname, c.relname;

select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'amountly_private') and p.prokind = 'f'
  and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass
                  and d.objid = p.oid and d.deptype = 'e')
order by n.nspname, p.proname, arguments;

-- Disabled protection triggers are release findings, not automatically repaired.
select n.nspname as schema_name, c.relname as table_name,
       t.tgname as trigger_name, t.tgenabled as enabled_mode
from pg_trigger t join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'amountly_private') and not t.tgisinternal
order by n.nspname, c.relname, t.tgname;

rollback;
