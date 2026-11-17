create or replace function public.get_user_organization_id()
returns uuid
language sql
stable
security definer
set search_path = '' as $$
  select organization_id from public.users where id = auth.uid()
$$;
