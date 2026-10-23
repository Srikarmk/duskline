-- Duskline — Supabase schema.
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run. It is
-- safe to run again: every statement is idempotent.
--
-- What it holds (the same three things the Upstash store held):
--   dl_scores    the shared leaderboard
--   dl_counters  the guest-number sequence and the per-minute rate limits
--   dl_kv        signed-in players' synced profiles, and spent race tickets
--
-- SECURITY. Row-level security is ON for every table with NO policies, so the
-- public (anon / publishable) key can read and write nothing. Only the game's
-- server, holding the service-role (secret) key, can touch these tables, and
-- it only does so through the five API routes. Never put that key in a
-- NEXT_PUBLIC_ variable.

-- --------------------------------------------------------------------------
-- tables
-- --------------------------------------------------------------------------

create table if not exists public.dl_scores (
  id          bigserial primary key,
  name        text        not null check (char_length(name) between 1 and 14),
  score       integer     not null check (score between 0 and 10000000),
  mode        text        not null,
  time_ms     integer     not null default 0 check (time_ms >= 0),
  day         date        not null default (now() at time zone 'utc')::date,
  created_at  timestamptz not null default now()
);
create index if not exists dl_scores_score_idx on public.dl_scores (score desc, id);

create table if not exists public.dl_counters (
  key         text primary key,
  value       bigint      not null default 0,
  expires_at  timestamptz            -- null = never (the guest sequence)
);

create table if not exists public.dl_kv (
  key         text primary key,
  value       jsonb       not null,
  expires_at  timestamptz not null
);
create index if not exists dl_kv_expires_idx on public.dl_kv (expires_at);
create index if not exists dl_counters_expires_idx on public.dl_counters (expires_at);

alter table public.dl_scores   enable row level security;
alter table public.dl_counters enable row level security;
alter table public.dl_kv       enable row level security;

-- --------------------------------------------------------------------------
-- functions — the operations that must be atomic
-- --------------------------------------------------------------------------

-- Add one to a counter and return the new value. With a ttl, the counter
-- restarts from 1 once it has expired (a rate-limit window); without one it
-- never expires (the guest sequence). One statement, so two requests at the
-- same instant cannot both read the old value.
create or replace function public.dl_incr(p_key text, p_ttl_seconds integer default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v bigint;
begin
  insert into dl_counters as c (key, value, expires_at)
  values (p_key, 1, case when p_ttl_seconds is null then null else now() + make_interval(secs => p_ttl_seconds) end)
  on conflict (key) do update
    set value = case when c.expires_at is not null and c.expires_at <= now() then 1 else c.value + 1 end,
        expires_at = case
          when c.expires_at is not null and c.expires_at <= now()
            then now() + make_interval(secs => coalesce(p_ttl_seconds, 0))
          else c.expires_at
        end
  returning value into v;

  -- Expired rate-limit windows and spent tickets would otherwise pile up
  -- forever. One call in a hundred tidies them; nothing depends on it running.
  if random() < 0.01 then
    delete from dl_counters where expires_at is not null and expires_at <= now();
    delete from dl_kv where expires_at <= now();
  end if;

  return v;
end;
$$;

-- Claim a key once. True if this call claimed it (it did not exist, or had
-- expired); false if someone already holds it. What a race ticket uses so one
-- ticket buys exactly one score.
create or replace function public.dl_set_once(p_key text, p_ttl_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed text;
begin
  insert into dl_kv as k (key, value, expires_at)
  values (p_key, 'true'::jsonb, now() + make_interval(secs => p_ttl_seconds))
  on conflict (key) do update
    set value = excluded.value, expires_at = excluded.expires_at
    where k.expires_at <= now()
  returning key into claimed;
  return claimed is not null;
end;
$$;

-- Add a score and keep the table to the best 1000. The board shows 20; the
-- rest is room for "where would I rank", and the cap means a flood of junk
-- scores cannot grow the table without bound.
create or replace function public.dl_add_score(
  p_name text, p_score integer, p_mode text, p_time_ms integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into dl_scores (name, score, mode, time_ms) values (p_name, p_score, p_mode, p_time_ms);
  delete from dl_scores
   where id in (
     select id from dl_scores order by score desc, id asc offset 1000
   );
end;
$$;

-- Only the server's role may call these. Revoking from the public roles means
-- the anon key cannot run them through the API either.
revoke all on function public.dl_incr(text, integer)                 from public, anon, authenticated;
revoke all on function public.dl_set_once(text, integer)             from public, anon, authenticated;
revoke all on function public.dl_add_score(text, integer, text, integer) from public, anon, authenticated;
grant execute on function public.dl_incr(text, integer)                  to service_role;
grant execute on function public.dl_set_once(text, integer)              to service_role;
grant execute on function public.dl_add_score(text, integer, text, integer) to service_role;
