# HCR League — Discord integration

Serverless integration between the website and the Discord server, running as
Supabase Edge Functions. The bot **token never touches the repo or the browser**
— it lives only as a Supabase secret.

## Functions

| Function | What it does | Trigger |
|---|---|---|
| `discord-sync` | Recomputes every driver's license from results; for anyone whose tier changed, swaps their Discord license role (Bronze→Silver…) and announces promotions in `#license-ups`. | Auto after a race is saved in the commissioner portal; also a manual "Sync now". Admin-only. |
| `discord-announce` *(next)* | Posts race podiums + updated standings to `#results` / `#standings`. | After a race import. |

## One-time setup (things only you can do)

### 1. Create the Discord application + bot
1. https://discord.com/developers/applications → **New Application** → name it "HCR League".
2. **Bot** tab → **Add Bot**. Copy the **Bot Token** (you'll paste it into Supabase, step 4).
3. **Bot** tab → enable **Server Members Intent**.
4. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`; bot permissions
   **Manage Roles**, **Send Messages**, **Embed Links**. Open the generated URL and invite
   the bot to your server.

### 2. Create the roles (in Discord: Server Settings → Roles)
Create **Bronze / Silver / Gold / Platinum** (and optionally **Driver**). Then drag the
bot's own role **above** all four license roles — Discord only lets a bot manage roles
below its own.

### 3. Collect the IDs (enable Developer Mode → right-click → Copy ID)
- The **Server (guild) ID**
- Each **role ID** (Bronze/Silver/Gold/Platinum/Driver)
- The **channel IDs** for `#results`, `#standings`, `#license-ups`, `#race-week`, `#signups-feed`

Put these in the `discord_config` row (a Discord settings tab in the commissioner portal
edits this — or update the row directly). Set `enabled = true` when ready.

### 4. Add the secret + deploy
```bash
# from the repo root, with the Supabase CLI linked to the project
supabase secrets set DISCORD_BOT_TOKEN=your-bot-token-here
supabase functions deploy discord-sync
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically — don't set them.

### 5. Link drivers to Discord
Role-swaps target a driver's `drivers.discord_user_id`. Members can add their Discord ID
on their account page (or the commissioner sets it). Announcements work without it; only
the automatic role-swap needs it.

## How it runs
- Save a race → `discord-sync` recomputes licenses, updates `drivers.license_current`,
  swaps roles for linked drivers, and posts promotions.
- First sync just initialises everyone's `license_current` and roles **without** spamming
  announcements (only genuine tier *increases* are announced afterward).
- The whole thing is a no-op while `discord_config.enabled = false`, so nothing breaks
  before setup is finished.
