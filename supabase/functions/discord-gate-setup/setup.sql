-- discord-gate-setup — the schema it needs.
--
-- APPLY THIS BEFORE THE FUNCTION IS RUN, and before it is even deployed if you like.
-- The function checks for both columns on every call and refuses every step with a
-- pointer back to this file if either is missing, so a forgotten apply is a clear
-- error rather than a half-configured server.
--
-- This project has no migrations directory and this file does not start one. Paste it
-- into the Supabase SQL editor (Dashboard → SQL Editor → New query → Run). It is safe
-- to run more than once: every statement is IF NOT EXISTS or a comment.
--
-- No policies are added or changed. discord_config already has RLS with admin-only
-- read and write, and discord-gate-setup reads and writes it with the service-role
-- key, which bypasses RLS entirely. Adding columns to a table that is already
-- protected inherits that protection; there is nothing new to grant.

alter table public.discord_config
  add column if not exists gate_role_id text;

alter table public.discord_config
  add column if not exists gate_restore jsonb;

comment on column public.discord_config.gate_role_id is
  'Discord role id of the "Verified" gate role — the key a member holds after pressing the '
  'button in #welcome. Written by discord-gate-setup {"step":"create-role"}, which adopts an '
  'existing role of that name rather than making a second one.';

comment on column public.discord_config.gate_restore is
  'How every channel discord-gate-setup touched looked BEFORE it touched it, written by '
  '{"step":"restrict"} before it makes a single Discord call and read by {"step":"revert"}. '
  'Shape: {version, taken_at, guild_id, gate_role_id, reverted_at, channels: {"<channel id>": '
  '{name, type, everyone: {present, allow, deny}, gate: {present, allow, deny}}}}. present=false '
  'means the channel carried no overwrite for that role at all, so revert deletes ours rather '
  'than writing a zeroed one. Entries are first-write-wins: a second restrict adds channels but '
  'never overwrites what an earlier one recorded, which is what keeps the escape route intact '
  'across a resumed run. reverted_at is stamped only when a revert finished the whole set — a '
  'null here with channels present means the gate is currently applied.';

-- DO NOT CLEAR gate_restore BY HAND while the gate is applied. It is the only record of
-- what the server's permissions were before, and without it revert refuses to guess.
