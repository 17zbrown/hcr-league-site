-- Signups drive Discord roles, and the link between a site account and its driver
-- row is made by the database rather than by a name matcher.
--
-- Why (12 Sep 2026): 14 drivers had entered the season on the site and all 14 sat
-- on Spectator, because the bot granted a class role only once race control had
-- SEATED them. Six of those had signed in with Discord — the site knew their
-- Discord id — but nothing copied it from profiles to the drivers row the bot
-- reads, and their Discord names did not match the roster, so the linker logged
-- no_match every half hour. Roles also only moved on a 15-minute cron, a quarter
-- of whose runs were dying on a PostgREST timeout.
--
-- This directory is a RECORD, not a pushable history: the project's earlier ~140
-- versions live only in supabase_migrations.schema_migrations, so `supabase db push`
-- will refuse. Apply a file here with the MCP apply_migration tool (which records
-- the version) or psql in one transaction, then prove it with read-only SQL — the
-- five trigger names in pg_trigger, one submit_change_request in pg_proc,
-- season_registrations.updated_at in information_schema.columns, the cron schedule.
-- Kept in the repo because an ad-hoc CREATE FUNCTION with a new signature once
-- became a second overload nobody could see from here.

-- 1. A profile that knows its Discord id hands it to its driver row. Fill-only,
--    snowflake-shaped, and never an id already held by another driver — the same
--    discipline as the linker and the commissioner's form. Runs as postgres, so it
--    behaves the same whether the profile write came from the service role
--    (discord-role-sync), a SECURITY DEFINER RPC (enter_season) or an admin.
create or replace function public.sync_profile_discord_to_driver()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.driver_id is null
     or new.discord_user_id is null
     or new.discord_user_id !~ '^\d{5,25}$' then
    return new;
  end if;
  update public.drivers d
     set discord_user_id = new.discord_user_id
   where d.id = new.driver_id
     and d.discord_user_id is null
     and not exists (select 1 from public.drivers x
                      where x.discord_user_id = new.discord_user_id and x.id <> d.id);
  return new;
end $$;

drop trigger if exists trg_profile_discord_to_driver on public.profiles;
create trigger trg_profile_discord_to_driver
  after insert or update of discord_user_id, driver_id on public.profiles
  for each row execute function public.sync_profile_discord_to_driver();

-- One-off backfill for the drivers already stranded this way.
update public.drivers d
   set discord_user_id = p.discord_user_id
  from public.profiles p
 where p.driver_id = d.id
   and d.discord_user_id is null
   and p.discord_user_id ~ '^\d{5,25}$'
   and not exists (select 1 from public.drivers x
                    where x.discord_user_id = p.discord_user_id and x.id <> d.id);

-- 2. A registration remembers when it last changed, so an "Update Registration"
--    from a driver who is waiting for a seat is visible as a change, not silence.
-- The column default stamps every existing row with the migration's now(), which
-- would make all fifty read as "changed today"; seed them from created_at instead.
alter table public.season_registrations
  add column if not exists updated_at timestamptz not null default now();
update public.season_registrations set updated_at = created_at;

-- Race control reads sign-ups too (every steward is an admin today, so this is
-- for the day one is not).
drop policy if exists sr_select on public.season_registrations;
create policy sr_select on public.season_registrations for select
  using (user_id = auth.uid() or public.is_admin(auth.uid())
         or public.is_race_control(auth.uid()) or public.is_team_manager(auth.uid()));

-- 3. enter_season: a driver who was seated from a timing sheet and later signs up
--    is the SAME driver — adopt the roster row by iRacing customer id instead of
--    creating a custid-less duplicate (Thomas Homer / Tom Homer, 10 Sep 2026).
--    Also stamps updated_at on a re-submission.
create or replace function public.enter_season(
  p_season_id uuid, p_display_name text, p_fia_category text, p_preferred_class text, p_notes text,
  p_iracing_name text default ''::text, p_iracing_custid text default ''::text,
  p_preferred_car text default ''::text, p_preferred_number text default ''::text,
  p_preferred_number_alt text default ''::text, p_nationality text default ''::text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_driver uuid;
  v_reg uuid;
  v_name text := btrim(coalesce(p_iracing_name, ''));
  v_custid text := btrim(coalesce(p_iracing_custid, ''));
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  -- Checked before anything is written, so a rejected entry leaves nothing behind
  -- — no half-made driver row, no profile edit. The table's CHECK constraint is
  -- the real guarantee; these raises exist so a driver reads a sentence they can
  -- act on instead of a constraint name.
  if v_name = '' then
    raise exception 'Your full iRacing name is required to enter the season.'
      using errcode = 'check_violation';
  elsif v_name !~ '\S\s+\S' then
    raise exception 'Enter your full iRacing name — first and last, exactly as it appears on your iRacing account.'
      using errcode = 'check_violation';
  end if;

  if v_custid = '' then
    raise exception 'Your iRacing customer ID is required to enter the season.'
      using errcode = 'check_violation';
  elsif v_custid !~ '^[0-9]+$' then
    raise exception 'Your iRacing customer ID must be digits only — it is the number on your iRacing account, not your name.'
      using errcode = 'check_violation';
  end if;

  select driver_id into v_driver from public.profiles where id = v_uid;
  if v_driver is null then
    select id into v_driver from public.drivers where user_id = v_uid limit 1;
  end if;
  if v_driver is null then
    -- The roster already knows this person by customer id (seated from a timing
    -- sheet, or invited before they had an account). That row is theirs: adopt it
    -- rather than make a second driver the grid cannot tell from the first. A
    -- customer id is a public number, so adoption needs two more things: nobody
    -- owns the row (no user_id AND no profile pointing at it), and the surname they
    -- typed matches the roster's. A wrong custid on a stranger falls through to the
    -- harmless custid-less insert below, as before.
    select d.id into v_driver from public.drivers d
     where d.iracing_custid = v_custid
       and d.user_id is null
       and not exists (select 1 from public.profiles p where p.driver_id = d.id)
       and lower(split_part(btrim(d.name), ' ', -1)) = lower(split_part(v_name, ' ', -1))
     limit 1;
    if v_driver is not null then
      update public.drivers set user_id = v_uid where id = v_driver;
    end if;
  end if;
  if v_driver is null then
    -- The custid was validated above, so the row is created complete rather than
    -- half-filled and waiting for a backfill nobody will remember to run.
    insert into public.drivers (name, user_id, iracing_custid)
    values (coalesce(nullif(p_display_name,''),'New Driver'), v_uid,
            case when exists (select 1 from public.drivers x where x.iracing_custid = v_custid)
                 then null else v_custid end)
    returning id into v_driver;
  else
    -- An existing driver row (made from a results PDF, or by an earlier version of
    -- this function) gets the custid it never had. Never overwrites one already set
    -- and never duplicates one held elsewhere.
    update public.drivers d
       set iracing_custid = v_custid
     where d.id = v_driver
       and nullif(btrim(coalesce(d.iracing_custid, '')), '') is null
       and not exists (select 1 from public.drivers x
                        where x.iracing_custid = v_custid and x.id <> d.id);
  end if;
  -- Fires trg_profile_discord_to_driver: a Discord sign-in links the driver here.
  update public.profiles set driver_id = v_driver,
    display_name = coalesce(nullif(p_display_name,''), display_name) where id = v_uid;

  -- The roster's flag follows what they told us, but never blanks one already set.
  if nullif(trim(p_nationality),'') is not null then
    update public.drivers set country = trim(p_nationality) where id = v_driver;
  end if;

  insert into public.season_registrations (season_id, user_id, driver_id, display_name, fia_category,
                                           preferred_class, preferred_car, preferred_number,
                                           preferred_number_alt, nationality, notes, iracing_name, iracing_custid)
  values (p_season_id, v_uid, v_driver, p_display_name, p_fia_category,
          p_preferred_class, nullif(p_preferred_car,''), nullif(trim(p_preferred_number),''),
          nullif(trim(p_preferred_number_alt),''), nullif(trim(p_nationality),''), p_notes,
          v_name, v_custid)
  on conflict (season_id, user_id) do update set
    display_name = excluded.display_name, fia_category = excluded.fia_category,
    preferred_class = excluded.preferred_class,
    -- A stale bundle sends none of these; treat absent as "unchanged" so it cannot
    -- wipe a choice already made.
    preferred_car = coalesce(excluded.preferred_car, public.season_registrations.preferred_car),
    preferred_number = coalesce(excluded.preferred_number, public.season_registrations.preferred_number),
    preferred_number_alt = coalesce(excluded.preferred_number_alt, public.season_registrations.preferred_number_alt),
    nationality = coalesce(excluded.nationality, public.season_registrations.nationality),
    notes = excluded.notes,
    iracing_name = excluded.iracing_name, iracing_custid = excluded.iracing_custid,
    updated_at = now()
  returning id into v_reg;
  return v_reg;
end $function$;

-- 4. The bot runs when something changes, not on the quarter hour. One async
--    enqueue per statement. discord_cron_invoke DROPS an ask that lands while a run
--    is already in flight (it does not queue it), so a change made mid-run waits for
--    the next 5-minute tick; the cron remains the backstop. A Discord hiccup must
--    never block a signup or a seat, hence the swallow.
create or replace function public.nudge_discord_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Never wait for the automation row. enter_season and roster_registration take
  -- drivers/profiles locks in the opposite order to this one, so a wait here could
  -- close a deadlock cycle. A row somebody else holds means a run is being asked
  -- for or recorded already; the cron backstop covers whatever this one skips.
  begin
    perform 1 from public.discord_automations where key = 'discord-driver-roles' for update nowait;
  exception when lock_not_available then
    return null;
  end;
  perform public.discord_cron_invoke('discord-driver-roles');
  return null;
exception when others then
  raise warning 'nudge_discord_roles: %', sqlerrm;
  return null;
end $$;

drop trigger if exists trg_nudge_roles_registrations on public.season_registrations;
create trigger trg_nudge_roles_registrations
  after insert or update of preferred_class, preferred_number, status, driver_id on public.season_registrations
  for each statement execute function public.nudge_discord_roles();

drop trigger if exists trg_nudge_roles_entry_drivers on public.entry_drivers;
create trigger trg_nudge_roles_entry_drivers
  after insert or update of withdrawn_at on public.entry_drivers
  for each statement execute function public.nudge_discord_roles();

drop trigger if exists trg_nudge_roles_entries on public.entries;
create trigger trg_nudge_roles_entries
  after update of status, class_id, number on public.entries
  for each statement execute function public.nudge_discord_roles();

-- Row-level and change-gated: every Discord sign-in updates profiles, whose trigger
-- runs a (usually 0-row) UPDATE on drivers, and a statement trigger would fire on
-- that and reconcile the whole server on every login.
drop trigger if exists trg_nudge_roles_drivers on public.drivers;
create trigger trg_nudge_roles_drivers
  after update of discord_user_id on public.drivers
  for each row
  when (old.discord_user_id is distinct from new.discord_user_id)
  execute function public.nudge_discord_roles();

-- 5. The backstop cadence, and labels that tell the truth about it. :04 past keeps
--    the house stagger (attendance-role :02/5, membership :03/10) and shares no
--    minute with the unoffset */5, */15, */20 and */30 jobs.
select cron.alter_job(jobid, schedule := '4-59/5 * * * *')
  from cron.job where jobname = 'hcr-discord-driver-roles';
update public.discord_automations
   set cadence = 'Every 5 minutes at :04 past, and usually within seconds of a sign-up, seat or link changing — a change that lands while a run is already in flight waits for the next tick',
       description = 'Sets each linked driver''s class role from their current seat — or from their sign-up while they wait for one — REMOVES the other class roles and Spectator, and pushes their "Name #car" nickname. It removes as well as adds — dry-run it first. Unlinked members are never touched.'
 where key = 'discord-driver-roles';
update public.discord_automations
   set cadence = 'Every 30 minutes',
       description = 'Matches roster-only drivers to Discord accounts by name (a Discord sign-in on the site links itself), and keeps the Spectator role tracking the entry list and the sign-up list. Only links where the name is unambiguous — an unsure match is left for a human rather than guessed. Asks for a Class roles run the moment it links anyone.'
 where key = 'discord-link-drivers';

-- 6. The 6-argument submit_change_request was superseded when team requests were
--    added; a body without p_teammate_ids matched both and PostgREST returned 300.
drop function if exists public.submit_change_request(text, text, uuid, uuid, uuid, text);
