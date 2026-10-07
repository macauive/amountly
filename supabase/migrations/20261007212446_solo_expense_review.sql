-- A solo review is a marker on an editable draft, never a team approval.
-- Historical expenses receive NULL; this migration creates no review events.
alter table public.expenses add column reviewed_at timestamptz;

create function amountly_private.protect_expense_review() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if current_user in ('authenticated','anon') and (
    (tg_op='INSERT' and new.reviewed_at is not null)
    or (tg_op='UPDATE' and new.reviewed_at is distinct from old.reviewed_at)
  ) then
    raise exception 'Use the expense review command' using errcode='42501';
  end if;
  -- Compare every substantive field so new expense fields cannot accidentally
  -- retain an old review. The command changes only the marker and updated_at.
  if tg_op='UPDATE' and old.reviewed_at is not null
    and (to_jsonb(new)-array['reviewed_at','updated_at'])
      is distinct from (to_jsonb(old)-array['reviewed_at','updated_at']) then
    new.reviewed_at:=null;
  end if;
  return new;
end $$;
revoke all on function amountly_private.protect_expense_review() from public,anon,authenticated;
create trigger protect_expense_review before insert or update on public.expenses
for each row execute function amountly_private.protect_expense_review();

-- Preserve the existing workflow checks. An owner may correct a rejected solo
-- expense or change its review marker without changing its REJECTED status.
create or replace function amountly_private.protect_work_record() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner_profile public.users; actor public.users; old_state text; new_state text;
begin
  select * into owner_profile from public.users where id=new.user_id;
  select * into actor from public.users where id=auth.uid() and is_active is true;
  if tg_op='UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'Record owner cannot be changed' using errcode='42501';
  end if;
  if new.project_id is not null and not exists (
    select 1 from public.projects p where p.id=new.project_id and (
      (owner_profile.organization_id is not null and p.organization_id=owner_profile.organization_id and p.user_id is null)
      or (owner_profile.organization_id is null and p.organization_id is null and p.user_id=new.user_id)
    )
  ) then raise exception 'Project must belong to this workspace' using errcode='42501'; end if;
  if new.task_id is not null and not exists (
    select 1 from public.tasks t where t.id=new.task_id and t.project_id=new.project_id
  ) then raise exception 'Task must belong to the selected project' using errcode='42501'; end if;
  if new.invoice_id is not null and not exists (
    select 1 from public.invoices i where i.id=new.invoice_id and (
      (owner_profile.organization_id is not null and i.organization_id=owner_profile.organization_id and i.user_id is null)
      or (owner_profile.organization_id is null and i.organization_id is null and i.user_id=new.user_id)
    )
  ) then raise exception 'Invoice must belong to this workspace' using errcode='42501'; end if;
  if auth.jwt()->>'role'='authenticated' then
    if actor.id is null then raise exception 'Active account required' using errcode='42501'; end if;
    new_state:=coalesce(new.status::text,'');
    if tg_op='UPDATE' then old_state:=old.status::text; end if;
    if (new_state not in ('DRAFT','SUBMITTED') or coalesce(old_state,'DRAFT') not in ('DRAFT','SUBMITTED','REJECTED'))
      and not (tg_table_name='expenses' and tg_op='UPDATE' and old_state='REJECTED' and new_state='REJECTED'
        and actor.id is not distinct from new.user_id and actor.account_type is not distinct from 'freelancer' and actor.organization_id is null) then
      if actor.organization_id is null or actor.organization_id is distinct from owner_profile.organization_id
        or actor.role not in ('OWNER','ADMIN') or actor.id=new.user_id then
        raise exception 'Independent workspace approval is required' using errcode='42501';
      end if;
      if tg_op='INSERT' or old_state not in ('SUBMITTED','APPROVED')
        or (old_state='SUBMITTED' and new_state not in ('APPROVED','REJECTED'))
        or (old_state='APPROVED' and new_state not in ('REIMBURSED'))
        or (to_jsonb(new)-array['status','updated_at']) is distinct from (to_jsonb(old)-array['status','updated_at']) then
        raise exception 'Invalid approval transition' using errcode='42501';
      end if;
    end if;
    if (tg_op='INSERT' and new.invoice_id is not null)
      or (tg_op='UPDATE' and new.invoice_id is distinct from old.invoice_id) then
      raise exception 'Invoice linkage requires the billing workflow' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function amountly_private.protect_work_record() from public,anon,authenticated;

-- Only the private, authorized command can cross the marker write guard.
-- A caller-controlled session setting would allow raw PATCH forgery instead.
create function amountly_private.set_expense_review(p_id uuid,p_reviewed boolean,p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare actor public.users; entry public.expenses;
begin
  if p_id is null or p_reviewed is null or p_expected_updated_at is null then
    raise exception 'Invalid review request' using errcode='22023';
  end if;
  select * into actor from public.users where id=auth.uid() and is_active is true for share;
  if actor.id is null or actor.account_type is distinct from 'freelancer' or actor.organization_id is not null then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  select * into entry from public.expenses where id=p_id and user_id=actor.id
    and archived_at is null and status in ('DRAFT','REJECTED') for update;
  if entry.id is null then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_expected_updated_at is distinct from entry.updated_at then raise exception 'Record changed' using errcode='PT409'; end if;
  -- Repeating the current state with the current version is a no-op: retain
  -- the original review time and avoid fabricated duplicate history events.
  if p_reviewed=(entry.reviewed_at is not null) then return; end if;
  update public.expenses set reviewed_at=case when p_reviewed then now() else null end where id=entry.id;
end $$;
revoke all on function amountly_private.set_expense_review(uuid,boolean,timestamptz) from public,anon;
grant execute on function amountly_private.set_expense_review(uuid,boolean,timestamptz) to authenticated;

create function public.set_expense_review(p_id uuid,p_reviewed boolean,p_expected_updated_at timestamptz)
returns void language sql security invoker set search_path='' as $$
  select amountly_private.set_expense_review(p_id,p_reviewed,p_expected_updated_at)
$$;
revoke all on function public.set_expense_review(uuid,boolean,timestamptz) from public,anon;
grant execute on function public.set_expense_review(uuid,boolean,timestamptz) to authenticated;

-- Add review provenance to the existing history stream. Sensitive receipt,
-- merchant, description and notes values continue to stay out of history.
create or replace function amountly_private.record_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare fields text[]; before_values jsonb; after_values jsonb;
  audited text[]:=array['amount','currency','expense_date','category','duration_minutes','billable_rate','start_at','end_at','due_date','paid_at','subtotal','tax_rate','tax_amount','total','status','archived_at','reviewed_at'];
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
      when tg_table_name='expenses' and to_jsonb(old)->>'reviewed_at' is not null and to_jsonb(new)->>'reviewed_at' is null then 'review_cleared'
      when tg_table_name='expenses' and to_jsonb(old)->>'reviewed_at' is null and to_jsonb(new)->>'reviewed_at' is not null then 'reviewed'
      when to_jsonb(new)->>'archived_at' is not null and to_jsonb(old)->>'archived_at' is null then 'archived'
      when new.status::text is distinct from old.status::text then 'status_changed' else 'updated' end,
      case when tg_op='UPDATE' then old.status::text end,new.status::text,coalesce(fields,'{}'),before_values,after_values);
  return new;
end $$;
revoke all on function amountly_private.record_change() from public,anon,authenticated;

-- Line-item edits also change the evidence covered by a prior expense review.
create function amountly_private.clear_expense_line_review() returns trigger
language plpgsql security definer set search_path='' as $$
declare parent_ids uuid[];
begin
  if tg_op='UPDATE' and to_jsonb(new) is not distinct from to_jsonb(old) then return new; end if;
  if tg_op='INSERT' then parent_ids:=array[new.expense_id];
  elsif tg_op='DELETE' then parent_ids:=array[old.expense_id];
  else parent_ids:=array[old.expense_id,new.expense_id]; end if;
  -- Advance a solo parent's version even before its first review, so a stale
  -- view of its line items cannot be reviewed with the pre-edit version.
  update public.expenses e set reviewed_at=null
    where e.id=any(parent_ids) and (e.reviewed_at is not null or exists (
      select 1 from public.users u where u.id=e.user_id and u.account_type='freelancer' and u.organization_id is null
    ));
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function amountly_private.clear_expense_line_review() from public,anon,authenticated;
create trigger clear_expense_line_review after insert or update or delete on public.expense_line_items
for each row execute function amountly_private.clear_expense_line_review();

notify pgrst,'reload schema';
