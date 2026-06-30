# HCR League — full deployment guide

This walks you from the zip file to a live public site, assuming you've never used Supabase or Netlify before. Two services, both free: **Supabase** (the database) and **Netlify** (hosting). Plan on ~30 minutes the first time.

```
hcr-league-site.zip  →  unzip  →  Supabase (database)  →  GitHub (code)  →  Netlify (live site)
```

---

## Before you start — prerequisites

1. **Unzip** `hcr-league-site.zip`. You'll get a folder `hcr-site` containing `app/`, `lib/`, `components/`, `supabase/`, `package.json`, etc.
2. **Node.js** — install the LTS version (20.x) from nodejs.org. Check it works: open a terminal and run `node -v` (should print `v20.something`).
3. **A GitHub account** (github.com) — free. Netlify deploys straight from a GitHub repo, which also gives you automatic redeploys when you change anything.
4. **Git** — install from git-scm.com if `git -v` doesn't already work. (Or use the GitHub Desktop app if you prefer clicking to typing — noted below.)

You do **not** need a credit card for any of this.

---

## Part A — Set up the database (Supabase)

### A1. Create the project
1. Go to **supabase.com** → **Start your project** → sign in (GitHub login is easiest).
2. Click **New project**.
3. Fill in:
   - **Name:** `hcr-league` (anything).
   - **Database Password:** generate a strong one and **save it somewhere** (you won't need it for this guide, but you'll want it later).
   - **Region:** pick the one closest to most of your members.
4. Click **Create new project** and wait ~2 minutes while it provisions.

### A2. Create the tables
1. In the left sidebar, open **SQL Editor**.
2. Click **+ New query**.
3. Open `supabase/schema.sql` from the unzipped folder, copy **all** of it, paste into the editor.
4. Click **Run** (or Ctrl/Cmd+Enter). You should see "Success. No rows returned." This creates every table, turns on security, and grants public read access.

### A3. Load the demo data
1. Click **+ New query** again.
2. Copy **all** of `supabase/seed.sql`, paste, **Run**.
3. This loads a sample Season 4 so every page has something to show. (You'll swap in your real data later — see Part F.)

### A4. Sanity-check it worked
- In the sidebar open **Table Editor** and click a few tables (`drivers`, `entries`, `results`). You should see rows. If so, the database is done.

### A5. Get your two connection values
You need a **Project URL** and a **public key**.

1. Click **Connect** at the top of the dashboard (or the **gear icon → API Keys**).
2. Copy the **Project URL** — it looks like `https://abcdxyz.supabase.co`.
3. Copy the **publishable key** (`sb_publishable_…`). If your project only shows legacy keys, copy the **`anon` `public`** key instead (a long `eyJ…` string). Either one works here — both are safe to expose in a browser because your tables are protected by the security rules from step A2.

> Keep these two values handy for Part B and Part D. The publishable/anon key is the *only* key that goes in the website. **Never** put the `service_role` or `secret` key in the site — that one stays private (it's for admin features in a later phase).

---

## Part B — Run it on your computer first (recommended)

This confirms everything works before you involve Netlify.

1. Open a terminal **inside the `hcr-site` folder**.
2. Create a file named **`.env.local`** in that folder with these two lines (paste your real values):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://abcdxyz.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_your_key_here
   ```
   (The variable is named `..._ANON_KEY` for both key types — paste whichever key you copied.)
3. Install and run:
   ```
   npm install
   npm run dev
   ```
4. Open **http://localhost:3000**. You should see the HCR League dashboard with the demo data.
   - If you instead see a "Database not connected" message, the `.env.local` values are missing or misspelled. Fix them and restart `npm run dev`.

Press Ctrl+C in the terminal to stop the local server when you're done.

---

## Part C — Put the code on GitHub

Netlify pulls from a GitHub repo.

**Option 1 — command line** (from inside `hcr-site`):
```
git init
git add .
git commit -m "HCR League site"
```
Then on github.com click **New repository**, name it `hcr-league-site`, **don't** add a README, and **Create**. GitHub then shows a "push an existing repository" snippet — copy the two lines, which look like:
```
git remote add origin https://github.com/YOUR-USERNAME/hcr-league-site.git
git branch -M main
git push -u origin main
```
Run those. Refresh the GitHub page and your files should be there.

**Option 2 — GitHub Desktop** (no terminal): install GitHub Desktop → **File → Add local repository** → choose the `hcr-site` folder → **Publish repository**.

> The `.gitignore` already excludes `node_modules`, `.next`, and `.env.local`, so your keys are **not** uploaded. Good.

---

## Part D — Deploy on Netlify

1. Go to **netlify.com** → sign up / log in (use **GitHub** so it can see your repos).
2. Click **Add new site → Import an existing project**.
3. Choose **GitHub**, authorize if asked, and pick your `hcr-league-site` repo.
4. Netlify auto-detects Next.js and fills in the build settings (build command `npm run build`; the Next.js runtime handles the rest). Leave them as detected.
5. **Before deploying, add your environment variables.** Find **Add environment variables** on this screen (or you can do it afterward under **Site configuration → Environment variables**). Add these:
   ```
   NEXT_PUBLIC_SUPABASE_URL       = https://abcdxyz.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY  = sb_publishable_your_key_here
   ANTHROPIC_API_KEY              = sk-ant-...        (server-only; powers the admin PDF import)
   ```
   The first two are public (they ship to the browser, protected by RLS). **`ANTHROPIC_API_KEY` is a secret** — it has no `NEXT_PUBLIC_` prefix, so it stays on the server and is only used by the admin import route. Get a key at https://console.anthropic.com. (You can skip it for now and add it later if you're not using PDF import yet.)
6. Click **Deploy**. The first build takes a couple of minutes.
7. When it finishes you'll get a live URL like `https://random-name-123.netlify.app`. Open it — your league is online.

### Rename it / add a custom domain
- **Site name:** Site configuration → **Change site name** (gives you `your-name.netlify.app`).
- **Custom domain** (e.g. `hcrleague.com`): **Domain management → Add a domain**, then follow the DNS steps. Netlify provisions free HTTPS automatically.

> **Important:** if you add or change an environment variable *after* the first deploy, Netlify won't pick it up until you redeploy. Go to **Deploys → Trigger deploy → Clear cache and deploy site**.

---

## Part E — Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Page says **"Database not connected"** | The two `NEXT_PUBLIC_…` env vars aren't set (or are misspelled) on Netlify. Add them, then **Trigger deploy → Clear cache and deploy site**. |
| Pages load but are **empty / no drivers or results** | `seed.sql` wasn't run, or it errored. Re-run it in the Supabase SQL Editor and check for errors. |
| A specific table is empty / a **42501** error in logs | A grant is missing. Re-run `schema.sql` (it now grants read access to the public role explicitly). |
| **Build fails on Netlify** | Usually a Node version mismatch. The repo includes a `.nvmrc` pinning Node 20; if it persists, add an env var `NODE_VERSION = 20` in Netlify and redeploy. |
| Local `npm run dev` complains about env | Make sure `.env.local` is in the `hcr-site` folder (same level as `package.json`) and you restarted the dev server. |
| Changed data in Supabase but the site looks stale | The site fetches fresh per request; just refresh. If you changed env vars, redeploy (see above). |

---

## Part F — After it's live

- **Updating the code:** push to GitHub (or commit in GitHub Desktop) and Netlify redeploys automatically.
- **Updating the data, for now:** until the admin screens land (Phase 2), edit data directly in Supabase's **Table Editor**, or send me your exported league JSON and I'll generate a `seed.sql` with your real drivers, entries, and results so you can load it in one paste.
- **What's next (Phase 2/3):** admin sign-in (real accounts, replacing the PIN) with editing screens, then the server-side PDF results import. Those add the `service_role`/secret key and an Anthropic key as **server-only** env vars — never in the browser.

That's the whole path. If you hit a wall at any step, tell me exactly what you see (the screen text or the error) and I'll get you unstuck.
