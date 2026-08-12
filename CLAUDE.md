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

**Championship scoring is ported in THREE places and they must agree:**
`src/lib/standings.ts` (the site), the `standings` branch of `discord-broadcast`, and
`handleStandings` in `discord-interactions`. Crew names normalised and sorted so
"A / B" and "B, A" are one entry; points = `points + quali_points + adjust`; `fill_in`
rows excluded; ties broken by best class finish. Change one, change all three, and
verify by running both over the same rows rather than reading them side by side.

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

**Attendance has exactly one source of truth**: the buttons on the attendance post,
recorded in `race_attendance`, shown in the private race-control tally. Only drivers
with an entry this season may press them; anyone else is refused with sign-up
instructions and nothing is recorded. Discord scheduled events are a CALENDAR — their
"Interested" list is read by nothing, and every event blurb says so.

**@everyone goes on results, standings and news** (`PINGS` in `discord-broadcast`).
Penalties and rulings deliberately stay quiet. The mention must sit in `content` —
an `@everyone` inside an embed renders as text and notifies nobody.

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
