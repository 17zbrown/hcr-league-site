# HCR League — working notes

An independent three-class iRacing endurance championship. GTP, LMP2 and GTD share
one grid and score three separate titles. Vite + React 18 + TS + Tailwind v4 +
TanStack Query, Supabase (Postgres + edge functions + pg_cron), deployed to
hcrleague.com from the `redesign-v2` branch. Supabase project `hcaduzaxviadzogmetcu`.
Discord guild `1204553403255226408`. iRacing league id **14470**.

One person runs this league in his spare time. A change that adds a recurring manual
chore is usually a bad change however tidy it looks. Prefer deleting something,
collapsing two things into one, or making an existing automatic thing tell the truth.

---

## Things that will bite you

**The Supabase CLI is authenticated on this machine — use it to deploy edge
functions.** `npx supabase@latest functions deploy <name> --project-ref hcaduzaxviadzogmetcu`
uploads the file from disk, so no transcription happens and the JSON-escape hazard
below cannot apply. Always name the function; a bare `functions deploy` would push
every one of them, and `discord-interactions` MUST stay `verify_jwt: false` (the CLI
defaults to true unless you pass `--no-verify-jwt`). Docker is not running and is not
needed — it warns and bundles remotely.

**Deploy edge functions from the repo, verbatim, and verify after.** Hand-transcribed
deploys have drifted from the repo more than once here. The MCP deploy tool's `files`
parameter is JSON-parsed, so escape TEXT you write can be silently DECODED into
literal characters and vice versa. `discord-broadcast` and `discord-interactions` both
contain a regex character class of combining diacritical marks that is a live example.
Always read the source back with `get_edge_function` afterwards and check the
escape-sensitive lines. The Supabase CLI does not round-trip through JSON and is the
reliable path when fidelity matters.

**`discord-interactions` MUST deploy with `verify_jwt: false`.** Not a shortcut — the
one function that needs the platform gate off. Discord posts interactions from its own
infrastructure and has no field to carry a Supabase credential; with the gate on, every
button in the live server silently stops working. Its security is Ed25519 signature
verification over the raw request body, which is stronger than a shared bearer token.

**A DISABLED TanStack Query reports `isLoading: false`.** It is `isPending && isFetching`
(query-core 5.101.2, `queryObserver.js:310`). The member pages chain queries —
`useCurrentSeason()` then `useEntries(season?.id)` — so during the first fetch the gated
ones look finished while holding no data. Gate UI on **presence of data**, never on
`isLoading`. See `gridStateKnown` in `src/pages/portal/MemberPortal.tsx`.

**No qualifying lap, no qualifying points — and the grid slot is not a substitute.**
A driver who sets no valid lap in qualifying has no qualifying result: `quali_pos` is
NULL and `quali_points` is 0, however far up the grid they started. Storing the
default grid slot as a qualifying position is what made those points look earned, and
it happened three times before the rule was written down (Tetreault R7, Collins11 and
Cronk R8, corrected 29 Aug). The reverse still holds: a driver who DID qualify keeps
those points even on a DNS, because qualifying is a session they contested. Rulebook
§31.

Only rounds 7 onward can be audited for this — `results` stores the qualifying
POSITION but never the qualifying LAP TIME, so for rounds 1-6 there is no way to tell
from the database who set a time and who was gridded by default. The source timing
sheets are the only record.

**Championship scoring is ported in THREE places and they must agree:**
`src/lib/standings.ts` (the site), the `standings` branch of `discord-broadcast`, and
`handleStandings` in `discord-interactions`. Crew names normalised and sorted so
"A / B" and "B, A" are one entry; points = `points + quali_points + adjust`; `fill_in`
rows excluded; ties broken by best class finish. Change one, change all three, and
verify by running both over the same rows rather than reading them side by side.

**Three race outcomes, and the DATABASE decides which — not the importer.**
`trg_results_lap_rule` on `results` normalises every row into exactly one of:

| outcome | test | points |
|---|---|---|
| `Running` | crossed the flag | scores normally |
| `DNF` | started, did not finish (≥1 lap) | **still scores on finishing position** |
| `DNS` | under one racing lap | `points` forced to 0 |

Not finishing is not the same as not taking part, so a DNF keeps everything its class
position earns — the classification already puts it behind the finishers, so the points
table does the demotion by itself. **Qualifying points always survive**, even a DNS:
qualifying is a different session and was actually contested.

Timing sheets disagree on vocabulary — iRacing writes `Disco`, others `Towed`/`Off`/
`Retired` — so anything that is not a recognised finish becomes `DNF`. A deliberate
`DSQ` is NEVER rewritten: a disqualification is a verdict, not a retirement.

It lives in a trigger because results arrive by three routes — the paste importer, the
commissioner grid and hand-written SQL — and a rule enforced in one is a rule the other
two break. Rulebook §31 still says drivers must "cross the checkered flag" to score;
read literally that strips every DNF, so the wording trails the practice.

**The bot clears its own spent posts, and that is not the same thing.**
`discord-attendance` already recycles yesterday's nudge, and `discord-attendance-role`
now removes the ask and its reminder from `#race-attendance` once the green flag has
flown (stamping `race_attendance_posts.cleared_at` so the delete is tried once, not
every five minutes). Nothing recoverable dies: the answers are rows in
`race_attendance`, and the staff tally and post-race recap in the private channel are
the record. The rule below is about the SERVER — its channels, categories, roles and a
room's history — not about a bot tidying up a question it already has the answer to.

**Never delete a Discord channel, category, role or message history.** Archive instead —
move it out of its category and hide it. This holds even with explicit authorisation.
The bot token is a Supabase secret and is never handled directly.

---

## How the pieces actually fit

**Getting on the grid is four steps, and step 3 is invisible to this database:**
sign in → enter the season (writes `season_registrations`) → **join the league on
iRacing** → race control confirms the seat (writes `entries` + `entry_drivers`).
A driver can be fully registered here and still unable to join the session. Unaccepted
iRacing invites are the usual cause of a short grid.

**Registering is not being seated.** `enter_season` writes `season_registrations`; the
`roster_registration(registration, number, class, car)` RPC is what creates the entry.
Anything answering "is this person on the grid?" must read both — reading `entries`
alone tells a driver who registered minutes ago that they did nothing.

**Attendance lives in #race-attendance, and the chase is a ROLE, not a roll call.**
The ask posts to `channel_race_attendance` (read-only for members — pressing a button
needs only VIEW_CHANNEL, so the room stays one post per race), falling back to
`channel_announcements` if that is unset. `channel_attendance` is a DIFFERENT channel:
the private staff tally in RACE CONTROL. Nudges mention `@Attendance Pending`, which
`discord-attendance-role` reconciles every five minutes from `race_attendance_tally` —
it holds exactly the on-grid drivers who have a linked Discord account and have not
answered, and clears itself when they answer, when the race starts, or when no drive
is open. Nobody is named. The bot's own role must sit ABOVE it or every assignment
403s.

**Attendance has exactly one source of truth**: the buttons on the attendance post,
recorded in `race_attendance`, shown in the private race-control tally. Only drivers
with an entry this season may press them; anyone else is refused with sign-up
instructions and nothing is recorded. Discord scheduled events are a CALENDAR — their
"Interested" list is read by nothing, and every event blurb says so.

**Newsroom house style — race reports, previews and penalty notices.**
Derived from how real series and teams actually write (Porsche Newsroom, Team Penske,
NBC Sports IMSA recaps), because the first drafts here read like magazine features and
made a comparison no racing writer would make.

- **Result first.** The lead names the winner, the class and what makes it notable —
  a streak, a drought, a first. Never open by setting a scene.
- **NEVER COMPARE LAP TIMES ACROSS EVENTS.** A lap time means something only against
  other laps at the same track in the same session. "Would have been quickest in
  almost any other week" is meaningless and was a real mistake in the Road America
  draft. Within-race superlatives (fastest lap of THIS race) are fine.
- **Anchor streaks to a venue and a round**, not to times: "his first win since Long
  Beach in Round 3". That is how the professional recaps date things.
- **Margins are positions, laps down, or gaps inside this race.** Real reports use
  numbers sparingly — "eleven laps down" beats a table of deltas.
- **Incidents and penalties are stated neutrally, never editorialised.** Say what
  happened and what it cost. No blame, no speculation about intent; the stewards own
  the verdict and it is published under its own rules.
- **One section per class**, same shape each time, in a consistent order.
- **Quotes, if any, sit after the results narrative**, attributed by name and role —
  not spliced mid-sentence.
- **Close with the next round.** Championship standings may precede it; the last line
  is where and when the grid races next.
- Past tense, plain voice, drivers and teams as the subject.

**@everyone goes on results, standings and news** (`PINGS` in `discord-broadcast`).
Penalties and rulings deliberately stay quiet. The mention must sit in `content` —
an `@everyone` inside an embed renders as text and notifies nobody.

**`events.date` is an INSTANT, and formatting it as a calendar day prints the wrong
day.** The green flag is 8pm ET on a Saturday, which is **midnight UTC on the Sunday**.
`src/lib/format.ts` used to slice the date out of the ISO string and rebuild it in
local time — so the whole schedule read as Sundays, the countdown targeted local
midnight (four hours late in ET), and the race-day forecast fetched the day AFTER the
race. Instants are now formatted as instants in the viewer's own zone with the zone
named; only a bare `YYYY-MM-DD`, which carries no time, is still built locally.
Real-world weather is GONE, deliberately (league directive, 1 Sep: this is a sim
league — show what iRacing shows). The Open-Meteo hooks, `wmo()` and `raceDateKey()`
were deleted with it; the race page's only weather is the in-sim table below. Do not
rebuild them.

**Races complete themselves at midnight, and the in-sim forecast is iRacing's, not
the sky's.** `advance_completed_events()` (cron `hcr-advance-events`, 04:00 UTC daily
= midnight ET race night) marks any current-season race complete three hours after its
green flag — `events.date` IS the green-flag timestamp — which fires the trigger below
exactly as a manual completion would. Results imported by hand-written SQL never
flipped the status, so every countdown and the attendance drive once pointed at a
finished race for three days. Separately, the race page's "In-sim forecast" block
reads `public.weather`, which mirrors the iRacing session editor: these sessions run a
different in-sim date under Realistic Weather, so the real-world Open-Meteo blocks on
the same page will NOT match it and are not supposed to. `iracing-weather-sync`
(cron `hcr-iracing-weather`, 09:00 UTC daily) refreshes that table during race week,
and stays dormant, saying so plainly, until IRACING_EMAIL and IRACING_PASSWORD exist
as Edge Function secrets.

**Completing a race triggers two things** (`trg_event_completed`): the next round is
promoted to `status='next'`, and that race's auto-preview is unpublished. Before this
existed both were manual, and forgetting the first silently stopped the attendance drive.

**Retired edge functions are 410 stubs in production**, and their repo files carry a
RETIRED banner at the top — `discord-restructure`, `discord-rebuild`, `discord-race-week`,
`auth-probe`. Redeploying one of those files restores the capability. Read the banner.

---

## Checks

```bash
npm run lint            # tsc -b --noEmit + an AST Rules-of-Hooks checker
npm run build           # og cards, hooks check, tsc, vite
npm run check:iracing   # entry rules agree across both client layers and the DB
npm run check:functions # edge function typecheck
```

The Rules-of-Hooks checker exists because a conditional hook took the whole newsroom
page down with a red screen. Do not add a hook after an early return.

---

## Verifying work

Prove it rather than assert it. Run destructive-looking SQL inside a transaction and
roll it back. Recount independently rather than trusting a report. When comparing two
implementations, execute both over the same data and diff the output. The browser
preview pane does not scroll — a scroll-position assertion there is inconclusive, not
failing.
