# HCR League — live site (Next.js + Supabase)

Phase 2 of the HCR League hub: a shared, public site backed by a real database. Public pages are read-only; admin editing + PDF import arrive in P2/P3.

## What's in this build (P1)

- The full public site, reading **live shared data** from Supabase: Dashboard, Schedule, Results archive, Championship hub (Drivers / Teams / Manufacturers / Cleanest), Records, Roster, and Driver profiles with lap charts.
- The new data model: drivers as people (stable IDs), cars as **entries** with co-driver lineups, seasons, tracks, structured penalties.
- Builds cleanly (`npm run build`).

Not yet wired (next phases): admin sign-in + CRUD (P2), manual results editor + server-side PDF import (P3).

## 1. Create the database (Supabase)

1. Make a free project at supabase.com.
2. In the project's **SQL Editor**, run `supabase/schema.sql` (creates tables + security).
3. Then run `supabase/seed.sql` (loads a demo season so every page has data).
4. From **Project Settings → API**, copy the **Project URL** and the **anon public** key.

## 2. Run locally

```bash
cp .env.example .env.local      # then fill in the two NEXT_PUBLIC_ values
npm install
npm run dev                     # http://localhost:3000
```

`.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://YOURPROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
```

(The `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY` are only needed once admin + PDF import land in P2/P3.)

## 3. Deploy to Netlify

1. Push this folder to a Git repo (GitHub/GitLab).
2. In Netlify: **Add new site → Import an existing project** → pick the repo. Netlify auto-detects Next.js (build command `npm run build`; the Next runtime handles the rest).
3. Under **Site settings → Environment variables**, add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Deploy. Add a custom domain in **Domain settings** if you want.

Because the anon key is gated by Row-Level Security (public can read, only signed-in admins can write), it's safe to expose in the browser — that's its purpose.

## Notes

- The site reads the **current season** (the one with `is_current = true`, pointed to by `league_settings.current_season_id`).
- Standings, manufacturer/cleanest tables, records, and career stats are computed in the app from results — same logic as the original app, now on shared data.
- To replace the demo data with your real league: export JSON from the current app and I'll generate a matching `seed.sql` (mapping number-based drivers into the new driver + entry model).
