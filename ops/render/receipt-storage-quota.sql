-- Forward, additive migration; run as the schema owner after private storage
-- tables exist. Replays rebuild usage under a table lock, preserving originals.
begin;
lock table amountly_files.receipts in access exclusive mode;
do $$ begin
  if to_regclass('amountly_files.capture_drafts') is not null then
    lock table amountly_files.capture_drafts in access exclusive mode;
  end if;
end $$;

-- A kept capture can point at its promoted, immutable original. Transfer bytes
-- in one transaction so completing a capture never needs a second allocation.
create unique index if not exists receipts_path_owner on amountly_files.receipts(path,owner_id);
do $$ begin
  if to_regclass('amountly_files.capture_drafts') is not null then
    alter table amountly_files.capture_drafts add column if not exists receipt_path text;
    alter table amountly_files.capture_drafts drop constraint if exists capture_drafts_check;
    alter table amountly_files.capture_drafts drop constraint if exists capture_file_original_check;
    alter table amountly_files.capture_drafts add constraint capture_file_original_check check (
      (contents is null and receipt_path is null and file_name is null and content_type is null and file_sha256 is null)
      or (file_name is not null and content_type is not null and file_sha256 is not null and file_sha256 ~ '^[a-f0-9]{64}$'
        and ((contents is not null and receipt_path is null)
          or (contents is null and receipt_path is not null and split_part(receipt_path,'/',1)=owner_id::text))));
    if not exists(select 1 from pg_catalog.pg_constraint where conrelid='amountly_files.capture_drafts'::regclass
      and conname='capture_receipt_original') then
      alter table amountly_files.capture_drafts add constraint capture_receipt_original
        foreign key(receipt_path,owner_id) references amountly_files.receipts(path,owner_id) deferrable initially deferred;
    end if;
  end if;
end $$;

create table if not exists amountly_files.storage_total (
  singleton boolean primary key check (singleton),
  bytes bigint not null check (bytes >= 0), objects bigint not null check (objects >= 0)
);
create table if not exists amountly_files.storage_owners (
  owner_id uuid primary key,
  bytes bigint not null check (bytes >= 0), objects bigint not null check (objects >= 0)
);
revoke all on amountly_files.storage_total, amountly_files.storage_owners from public, authenticated;

-- Reconstruct counters from actual bytes, including already-over-budget owners.
delete from amountly_files.storage_owners;
insert into amountly_files.storage_owners
select owner_id, sum(octet_length(contents)), count(*) from amountly_files.receipts group by owner_id;
do $$ begin
  if to_regclass('amountly_files.capture_drafts') is not null then
    insert into amountly_files.storage_owners
    select owner_id,sum(octet_length(contents)),count(*) from amountly_files.capture_drafts
    where contents is not null group by owner_id
    on conflict(owner_id) do update set bytes=storage_owners.bytes+excluded.bytes, objects=storage_owners.objects+excluded.objects;
  end if;
end $$;
insert into amountly_files.storage_total
select true,coalesce(sum(bytes),0),coalesce(sum(objects),0) from amountly_files.storage_owners
on conflict(singleton) do update set bytes=excluded.bytes,objects=excluded.objects;

create or replace function amountly_files.enforce_storage_budget() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  old_bytes bigint := 0; new_bytes bigint := 0;
  old_objects bigint := 0; new_objects bigint := 0;
  previous_owner uuid; next_owner uuid;
  total amountly_files.storage_total%rowtype;
  own amountly_files.storage_owners%rowtype;
begin
  if tg_op <> 'INSERT' then
    previous_owner := old.owner_id;
    old_bytes := coalesce(octet_length(old.contents),0);
    old_objects := case when old.contents is null then 0 else 1 end;
  end if;
  if tg_op <> 'DELETE' then
    next_owner := new.owner_id;
    new_bytes := coalesce(octet_length(new.contents),0);
    new_objects := case when new.contents is null then 0 else 1 end;
  end if;
  -- Atomic row updates serialize every writer even at REPEATABLE READ. A stale
  -- snapshot fails with serialization error rather than accepting excess bytes.
  -- All writers lock global then owner counters; no owner/global lock inversion.
  update amountly_files.storage_total set bytes=bytes+new_bytes-old_bytes,
    objects=objects+new_objects-old_objects where singleton returning * into total;
  if not found then raise exception 'Storage unavailable' using errcode='55000'; end if;
  if (new_bytes>old_bytes and total.bytes>1073741824)
    or (new_objects>old_objects and total.objects>10000) then
    raise exception 'Storage limit reached' using errcode='PT413';
  end if;
  if previous_owner is not null and old_objects > 0 then
    update amountly_files.storage_owners set bytes=bytes-old_bytes,objects=objects-old_objects
    where owner_id=previous_owner;
    if not found then raise exception 'Storage unavailable' using errcode='55000'; end if;
  end if;
  if next_owner is not null then
    insert into amountly_files.storage_owners(owner_id,bytes,objects) values(next_owner,new_bytes,new_objects)
    on conflict(owner_id) do update set bytes=storage_owners.bytes+excluded.bytes,
      objects=storage_owners.objects+excluded.objects returning * into own;
    if (own.bytes>262144000 and (next_owner is distinct from previous_owner or new_bytes>old_bytes))
      or (own.objects>1000 and (next_owner is distinct from previous_owner or new_objects>old_objects)) then
      raise exception 'Storage limit reached' using errcode='PT413';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function amountly_files.enforce_storage_budget() from public, authenticated;
drop trigger if exists storage_budget on amountly_files.receipts;
create trigger storage_budget before insert or update or delete on amountly_files.receipts
for each row execute function amountly_files.enforce_storage_budget();
do $$ begin
  if to_regclass('amountly_files.capture_drafts') is not null then
    drop trigger if exists storage_budget on amountly_files.capture_drafts;
    create trigger storage_budget before insert or update or delete on amountly_files.capture_drafts
    for each row execute function amountly_files.enforce_storage_budget();
  end if;
end $$;

-- Uploads fail closed if a deployment omits the forward migration or either
-- table's trigger. This exposes no usage totals or other users' private state.
create or replace function amountly_files.storage_budget_ready() returns boolean
language sql security definer set search_path='' as $$
  select exists(select 1 from pg_catalog.pg_trigger where tgrelid='amountly_files.receipts'::regclass
    and tgname='storage_budget' and tgenabled in ('O','A')
    and tgfoid='amountly_files.enforce_storage_budget()'::regprocedure)
  and (to_regclass('amountly_files.capture_drafts') is null or exists(
    select 1 from pg_catalog.pg_trigger where tgrelid=to_regclass('amountly_files.capture_drafts')
    and tgname='storage_budget' and tgenabled in ('O','A')
    and tgfoid='amountly_files.enforce_storage_budget()'::regprocedure));
$$;
revoke all on function amountly_files.storage_budget_ready() from public;
grant execute on function amountly_files.storage_budget_ready() to authenticated;
commit;
