-- ═══════════════════════════════════════════════════════════════════
-- LISAANY: Single-device session enforcement
-- Run this ONCE in Supabase Dashboard → SQL Editor → New query
-- ═══════════════════════════════════════════════════════════════════

-- 1. Table: one row per user, tracking their currently active device
create table if not exists public.active_sessions (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  device_id    text not null,
  user_agent   text,
  signed_in_at timestamptz not null default now()
);

-- 2. Row-Level Security
alter table public.active_sessions enable row level security;

-- Drop old policies if re-running
drop policy if exists "Users can read own session"   on public.active_sessions;
drop policy if exists "Users can write own session"  on public.active_sessions;

-- Users can read only their own row
create policy "Users can read own session"
  on public.active_sessions
  for select
  using (auth.uid() = user_id);

-- Users can insert/update only their own row
create policy "Users can write own session"
  on public.active_sessions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3. Add to realtime publication (so clients can subscribe to changes)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'active_sessions'
  ) then
    alter publication supabase_realtime add table public.active_sessions;
  end if;
end $$;

-- 4. Verify
select 'OK: active_sessions table created' as status;
