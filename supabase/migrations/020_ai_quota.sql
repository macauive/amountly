-- Durable, atomic quotas: at most 10 AI requests per UTC minute and 100 per UTC day.
-- Only the consuming RPC can access counters; callers cannot reset them.
create table public.ai_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  minute_start timestamptz not null,
  minute_count integer not null default 0 check (minute_count >= 0),
  day_start timestamptz not null,
  day_count integer not null default 0 check (day_count >= 0)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from public, anon, authenticated;

create function public.consume_ai_quota()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  now_at timestamptz := clock_timestamp();
  minute_at timestamptz := date_trunc('minute', now_at, 'UTC');
  day_at timestamptz := date_trunc('day', now_at, 'UTC');
  usage public.ai_usage;
begin
  if actor is null or not exists (
    select 1 from public.users where id = actor and is_active is true
  ) then
    raise exception 'AI access denied' using errcode = '42501';
  end if;

  insert into public.ai_usage (user_id, minute_start, day_start)
  values (actor, minute_at, day_at) on conflict (user_id) do nothing;
  select * into usage from public.ai_usage where user_id = actor for update;
  -- Compute windows after acquiring the lock, including requests queued across a boundary.
  now_at := clock_timestamp();
  minute_at := date_trunc('minute', now_at, 'UTC');
  day_at := date_trunc('day', now_at, 'UTC');
  if usage.minute_start < minute_at then usage.minute_count := 0; end if;
  if usage.day_start < day_at then usage.day_count := 0; end if;
  if usage.minute_count >= 10 or usage.day_count >= 100 then return false; end if;

  update public.ai_usage set
    minute_start = minute_at, minute_count = usage.minute_count + 1,
    day_start = day_at, day_count = usage.day_count + 1
  where user_id = actor;
  return true;
end;
$$;
revoke all on function public.consume_ai_quota() from public, anon;
grant execute on function public.consume_ai_quota() to authenticated;
