# HCR League — Discord integration

Serverless integration between the website and the Discord server, running as
Supabase Edge Functions. The bot **token never touches the repo or the browser**
— it lives only as a Supabase secret. Non-secret IDs (server, roles, channels)
are edited in **Admin → Discord**.

## Functions

| Function | What it does | Trigger |
|---|---|---|
| `discord-role-sync` | Reads the signed-in user's roles in your Discord server and sets their portal access (Admin / Race Control / Member). | Automatically on Discord sign-in. |
| `discord-sync` | Recomputes every driver's license from results, swaps their Discord license role (Bronze→Silver…) and announces promotions. | Automatically after a race is saved; admin-only. |
| `discord-announce` *(not built yet)* | Posts race podiums + standings to `#results` / `#standings`. | After a race import. |

## One-time setup (only you can do these)

### 1. Create the Discord application + bot
1. https://discord.com/developers/applications → **New Application** → "HCR League".
2. **Bot** tab → **Add Bot**, copy the **Bot Token** (step 5).
3. **Bot** tab → enable **Server Members Intent** (required to read member roles).
4. **OAuth2 → General**: copy the **Client ID** and **Client Secret** (step 3), and add this
   **Redirect URL**:
   `https://hcaduzaxviadzogmetcu.supabase.co/auth/v1/callback`
5. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`; bot permissions
   **Manage Roles**, **Send Messages**, **Embed Links**. Open the URL and invite the bot.

### 2. Create the roles (Server Settings → Roles)
- Access roles: **Admin**, **Race Control**
- License roles: **Bronze / Silver / Gold / Platinum**

Then drag the **bot's own role above all of them** — Discord won't let a bot manage roles
positioned above its own.

### 3. Turn on Discord login in Supabase
Supabase dashboard → **Authentication → Providers → Discord** → enable, paste the
**Client ID** and **Client Secret** from step 1. Under **URL Configuration**, make sure
`https://hcrleague.com` is in the allowed redirect list.

### 4. Fill in the IDs on the site
Enable Discord **Developer Mode** (User Settings → Advanced), then right-click to
**Copy ID** for the server, each role and each channel. Paste them into
**Admin → Discord**, tick **Enabled**, and save.

### 5. Add the bot token + deploy
```bash
supabase secrets set DISCORD_BOT_TOKEN=your-bot-token-here
supabase functions deploy discord-role-sync
supabase functions deploy discord-sync
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically — don't set them.

### 6. Verify, then (optionally) retire email login
1. Sign in with Discord in a private window.
2. Confirm you land in the **Admin** portal (your Discord Admin role mapped through).
3. Only once that works, remove the email/password form from `src/pages/Login.tsx`.

> **Don't skip step 6.** Until Discord sign-in is proven to grant you admin, email/password
> is your only way into the Admin portal. Removing it early locks you out of your own site.

## How access is decided
On each Discord sign-in, `discord-role-sync` looks up the member in your server and maps:
**Admin role → `admin`**, **Race Control role → `race_control`**, otherwise **`member`**
(highest wins). Anyone not in the server is refused. Roles can still be set by hand in
**Admin → Members**, which is the fallback whenever the integration is off.
