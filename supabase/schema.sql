-- ============================================================================
--  HCR League — Supabase schema (Phase 2 production rebuild)
--  Run this in the Supabase SQL editor (or `supabase db push`).
--  Postgres / Supabase. Re-runnable: guarded with "if not exists" + policy drops.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  Reference data & league-wide settings
-- ----------------------------------------------------------------------------
create table if not exists league_settings (
  id                int primary key default 1,
  name              text not null default 'HCR League',
  tagline           text default '',
  timezone          text default 'ET',          -- display label only
  discord_url       text default '',
  broadcast_url     text default '',
  rulebook_url      text default '',
  current_season_id uuid,
  constraint one_row check (id = 1)
);

create table if not exists classes (
  id    text primary key,                        -- 'GTP', 'LMP2', 'GTD'
  name  text not null,
  color text not null default '#FFFFFF',
  sort  int  not null default 0
);

create table if not exists tracks (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  location  text default '',
  length_km numeric,
  config    text default '',
  corners   int
);

-- ----------------------------------------------------------------------------
--  Seasons  (true containers; everything below hangs off a season)
-- ----------------------------------------------------------------------------
create table if not exists seasons (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,                    -- 'Season 4'
  year         int,
  is_current   boolean not null default false,
  -- points awarded for finishing P1, P2, ... within a class:
  points_table jsonb  not null default '[35,32,30,28,26,25,24,23,22,21,20,19,18,17,16,15,14,13,12,11]',
  drop_weeks   int    not null default 0,        -- worst N rounds dropped from each total
  created_at   timestamptz default now()
);

-- ----------------------------------------------------------------------------
--  People & teams
--  A driver is a *person* with a stable identity, NOT a car number.
-- ----------------------------------------------------------------------------
create table if not exists drivers (
  id             uuid primary key default gen_random_uuid(),
  iracing_custid text unique,                    -- stable identity (recommended)
  name           text not null,
  country        text default '',                -- flag emoji or ISO code
  bio            text default '',
  created_at     timestamptz default now()
);

create table if not exists teams (
  id   uuid primary key default gen_random_uuid(),
  name text not null
);

-- ----------------------------------------------------------------------------
--  Entries  (a CAR in a season: number + class + team + model)
--  This is the thing that scores points. Co-drivers share one entry.
-- ----------------------------------------------------------------------------
create table if not exists entries (
  id        uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  number    text not null,                       -- car number (per season)
  class_id  text not null references classes(id),
  team_id   uuid references teams(id) on delete set null,
  car       text default '',
  unique (season_id, class_id, number)           -- one car per number+class+season
);

-- lineup: which drivers share this car (1..n co-drivers)
create table if not exists entry_drivers (
  entry_id  uuid not null references entries(id) on delete cascade,
  driver_id uuid not null references drivers(id) on delete cascade,
  primary key (entry_id, driver_id)
);

-- ----------------------------------------------------------------------------
--  Events, sessions, weather
-- ----------------------------------------------------------------------------
create table if not exists events (
  id             uuid primary key default gen_random_uuid(),
  season_id      uuid not null references seasons(id) on delete cascade,
  round          int  not null,
  track_id       uuid references tracks(id) on delete set null,
  date           timestamptz,                    -- real-world race time
  duration_h     numeric default 6,
  status         text default 'upcoming',        -- upcoming | next | complete
  sim_start_hour numeric default 12,             -- in-sim time of day (0-24)
  time_mult      numeric default 1,              -- in-sim time scale
  points_mult    numeric default 1,              -- e.g. 2x finale
  min_drivers    int,
  max_drivers    int,
  notes          text default '',
  broadcast_url  text default ''                 -- per-event override (optional)
);

create table if not exists sessions (
  id       uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  type     text not null,                        -- Practice | Qualify | Race
  start    timestamptz,                          -- real-world start
  dur_min  int,
  sort     int default 0
);

create table if not exists weather (
  id       uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  at_hour  numeric,                              -- in-sim hour the snapshot applies to
  air_f    numeric,                              -- imperial
  sky      text,
  precip   int,
  wind_mph numeric,
  humidity int,
  sort     int default 0
);

-- ----------------------------------------------------------------------------
--  Results  (one row per car per event) + per-lap data
--  Attaches to an ENTRY, so points flow to the entry's whole lineup.
--  class_id / number are denormalized so PDF imports can land before the
--  entry is matched, then be linked to entry_id.
-- ----------------------------------------------------------------------------
create table if not exists results (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  entry_id    uuid references entries(id) on delete set null,
  class_id    text references classes(id),
  number      text,
  drivers_text text default '',                  -- as printed on the PDF (fallback display)
  pos         int,
  cls_pos     int,
  grid        int,
  inc         int,
  laps        int,
  total_time  text,
  gap         text,
  intvl       text,
  best_lap    text,
  best_on     int,
  status      text,
  points      numeric default 0,
  adjust      numeric default 0,                 -- stewards' +/- adjustment
  adjust_note text default '',
  unique (event_id, class_id, number)
);

create table if not exists laps (
  id        uuid primary key default gen_random_uuid(),
  result_id uuid not null references results(id) on delete cascade,
  driver_id uuid references drivers(id) on delete set null,  -- optional stint attribution
  lap       int not null,
  time      text,
  sec       numeric
);

-- ----------------------------------------------------------------------------
--  Champions archive (past seasons, incl. pre-system ones via free text)
-- ----------------------------------------------------------------------------
create table if not exists champions (
  id          uuid primary key default gen_random_uuid(),
  season_name text not null,                     -- 'Season 3'
  year        int,
  class_id    text,                              -- nullable
  kind        text default 'driver',             -- driver | team | manufacturer
  label       text not null,                     -- name as displayed
  sort        int default 0
);

-- ----------------------------------------------------------------------------
--  Indexes
-- ----------------------------------------------------------------------------
create index if not exists idx_entries_season       on entries(season_id);
create index if not exists idx_entry_drivers_driver  on entry_drivers(driver_id);
create index if not exists idx_events_season         on events(season_id);
create index if not exists idx_sessions_event        on sessions(event_id);
create index if not exists idx_weather_event         on weather(event_id);
create index if not exists idx_results_event         on results(event_id);
create index if not exists idx_results_entry         on results(entry_id);
create index if not exists idx_laps_result           on laps(result_id);

-- ----------------------------------------------------------------------------
--  Row-Level Security
--  Everyone (anon) can READ the public site.
--  Only signed-in admins (Supabase Auth) can WRITE.
-- ----------------------------------------------------------------------------
-- Admin allowlist: only these emails may write, even if signup is enabled.
create table if not exists admin_emails ( email text primary key );
alter table admin_emails enable row level security;
drop policy if exists "admins read allowlist" on admin_emails;
create policy "admins read allowlist" on admin_emails for select to authenticated using (true);
grant select on admin_emails to authenticated;
-- >>> add the email(s) of your admin(s) here:
-- insert into admin_emails (email) values ('you@example.com') on conflict do nothing;

do $$
declare t text;
begin
  foreach t in array array[
    'league_settings','classes','tracks','seasons','drivers','teams',
    'entries','entry_drivers','events','sessions','weather','results','laps','champions'
  ] loop
    execute format('alter table %I enable row level security;', t);

    execute format('drop policy if exists "public read" on %I;', t);
    execute format('create policy "public read" on %I for select using (true);', t);

    execute format('drop policy if exists "admin write" on %I;', t);
    execute format($f$create policy "admin write" on %I for all to authenticated
        using ((auth.jwt() ->> 'email') in (select email from admin_emails))
        with check ((auth.jwt() ->> 'email') in (select email from admin_emails));$f$, t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
--  Data API grants
--  RLS decides which ROWS a role can touch; grants decide whether a table is
--  reachable through the API at all. New Supabase projects may not auto-grant,
--  so we grant explicitly: anon can read, authenticated (admins) can write.
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;

-- ============================================================================
--  NOTES
--  • Standings, manufacturer tables, "cleanest", records and driver career
--    stats are DERIVED from results (+ entry_drivers + points_table + drop_weeks)
--    in the app layer — same logic as the current app, but now reading shared
--    data. Optional SQL views can be added later if we want DB-side rollups.
--  • Points correctness: a result -> entry -> lineup, so every co-driver is
--    credited, and a driver's history follows the PERSON, not the number.
--  • To make a season active: set seasons.is_current = true and
--    league_settings.current_season_id = that season's id.
-- ============================================================================
