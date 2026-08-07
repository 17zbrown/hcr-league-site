# HCR gateway bot — deployment runbook

Discord tells nobody when a member leaves. The site's `discord-membership` edge
function works around that by rolling the member list every two minutes and
diffing it, which means a departure can go unnoticed for up to two minutes and a
welcome can land two minutes late.

This bot removes that delay. It holds one permanent WebSocket to Discord's
gateway, and the moment someone joins or leaves it makes a single HTTPS call:

```
Discord gateway event  ->  POST to discord-gateway-hook  ->  discord-membership does the work
```

**The bot is a relay, not a second brain.** It writes no messages, posts nothing
to Discord, reads no database, and knows nothing about the league. Every decision
still happens in the edge functions, exactly as it does today. That is what makes
step 6 — rollback — a single command with no consequences.

Everything below assumes a fresh Oracle Cloud account and no knowledge of this
codebase. Budget about forty minutes.

---

## 0. Before you start

You need:

- An Oracle Cloud account (the Always Free tier; no card charge if you follow §1).
- The **Discord bot token** — Discord Developer Portal, your application, **Bot**
  tab. This is the same token the edge functions already use.
- The **guild ID** — the Discord server's ID (right-click the server with
  Developer Mode on, **Copy Server ID**).
- **Server Members Intent** enabled for the bot, in the Developer Portal's **Bot**
  tab. `discord-membership` already needs it to read the member list, so it is
  almost certainly on — but confirm it, because with it off the gateway connects
  happily and simply never mentions that anyone joined.
- The **gateway shared secret** — the plaintext in `oracle-gateway/.gateway-secret`
  in this repo. That file is gitignored on purpose; the database holds only its
  SHA-256, in `public.discord_config.gateway_secret_sha256`. That hash is already
  stored for the current secret. See §3 only if you need to rotate it.
- The `discord-gateway-hook` edge function deployed, with JWT verification **off**:

  ```bash
  supabase functions deploy discord-gateway-hook
  supabase functions list          # confirm the slug and that it is ACTIVE
  ```

  Note there is **no** `--no-verify-jwt`. JWT verification stays on, matching
  every other function in this project, so the VM has to pass two gates rather
  than one.

  An earlier draft turned it off on the reasoning that only the service-role key
  can invoke a JWT-protected function, and that a machine on the public internet
  should not hold one. That premise is wrong: `verify_jwt` accepts any JWT signed
  with the project's JWT secret, and the **anon key is one** — the commissioner
  portal already invokes functions with it. So the VM carries the anon key
  (`HCR_HOOK_AUTH`, §3), which grants it nothing the public website does not
  already grant every visitor, and Supabase rejects unauthenticated callers before
  the function or the database is touched.

  The shared secret is still the real gate. What is behind it is deliberately
  tiny: it takes no parameter that changes what happens, it can address no
  automation other than `discord-membership`, and the worst a caller holding both
  credentials could do is make the league re-read its own member list slightly
  more often than the cron already does.

---

## 1. Pick the Oracle shape — Always Free only

In the Oracle console: **Compute -> Instances -> Create instance**.

Set the image to **Canonical Ubuntu 22.04** (24.04 is fine too). Then, under
**Shape -> Change shape**, pick one of these two and nothing else:

| Shape | Notes |
|---|---|
| `VM.Standard.A1.Flex` (Ampere, ARM) | Set it to **1 OCPU / 6 GB**. Far more than this needs. Frequently returns **"Out of host capacity"** in popular regions — sometimes for weeks. If you get that error, do not go hunting for a bigger shape; use the row below. |
| `VM.Standard.E2.1.Micro` (AMD) | 1/8 OCPU, 1 GB RAM. Much smaller, almost always available. **Ample for this job** — one WebSocket and a Node process that is idle between events. Two of these are free forever. |

> **Do not pick a paid shape by accident.** The shape list mixes free and billable
> options in one menu. Only shapes carrying the green **"Always Free-eligible"**
> tag are free. `VM.Standard.E3/E4/E5.Flex` are not. An A1.Flex above 4 OCPUs or
> 24 GB total is not. If your account has been upgraded to Pay As You Go, nothing
> stops you selecting a billable shape and nothing warns you afterwards — check
> the tag before you click Create.

Two more things on that page:

- **Boot volume:** leave it at the default (about 47 GB). The free allowance is
  200 GB total across all volumes; the default is well inside it. Do not attach a
  block volume — you will not need one.
- **SSH keys:** paste your public key now. Oracle cannot show it to you later, and
  there is no password login on these images.

Create the instance and note its **public IP**.

---

## 2. Set up Ubuntu

SSH in as `ubuntu@<public-ip>`.

```bash
sudo apt-get update && sudo apt-get upgrade -y

# Node 20 LTS. NodeSource is used rather than Ubuntu's own package because
# 22.04 ships Node 12, which is years past end of life. Adding this repo also
# means future `apt upgrade` runs keep Node patched — which matters here, see §3.
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v          # expect v20.x
```

Create the account the service runs as. It has no home directory, no shell and no
password — it exists only to own a process.

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin hcr-gateway
```

Copy the bot across. From **your laptop**, in the repo root:

```bash
scp -r "oracle-gateway/" ubuntu@<public-ip>:/tmp/hcr-gateway
```

Then back on the VM:

```bash
sudo mkdir -p /opt/hcr-gateway
sudo cp -r /tmp/hcr-gateway/. /opt/hcr-gateway/
sudo rm -rf /tmp/hcr-gateway

# scp copies dotfiles too, so the plaintext secret came along for the ride. On
# this machine it belongs in the environment file (§3) and nowhere else.
sudo rm -f /opt/hcr-gateway/.gateway-secret

# The code is owned by root and is NOT writable by the account that runs it.
# A compromised bot process should not be able to rewrite the bot.
sudo chown -R root:root /opt/hcr-gateway
sudo chmod -R go-w /opt/hcr-gateway
```

Install the bot's one dependency. It uses `discord.js` for the gateway
connection, so this step is not optional — without it the service exits at once
with a module-not-found error:

```bash
cd /opt/hcr-gateway && sudo npm install --omit=dev
ls -d /opt/hcr-gateway/node_modules/discord.js     # must exist
```

`node_modules` ends up root-owned alongside the code, which is what we want: the
service reads it and cannot rewrite it.

---

## 3. The environment file

Create it empty, lock it down, then fill it in:

```bash
sudo touch /etc/hcr-gateway.env
sudo chown root:root /etc/hcr-gateway.env
sudo chmod 0600 /etc/hcr-gateway.env
sudo nano /etc/hcr-gateway.env
```

Contents — four lines, no `export`, no quotes, no spaces around the `=`, and no
trailing comments on a value line (systemd would read them as part of the value):

```
DISCORD_BOT_TOKEN=the-bot-token-from-the-discord-developer-portal
HCR_GUILD_ID=the-discord-server-id
HCR_HOOK_URL=https://hcaduzaxviadzogmetcu.supabase.co/functions/v1/discord-gateway-hook
HCR_GATEWAY_SECRET=the-plaintext-from-oracle-gateway/.gateway-secret
```

- `DISCORD_BOT_TOKEN` — the bot's token. See the warning below.
- `HCR_GUILD_ID` — the league's server ID. The bot drops events from any other
  server the same bot happens to be in.
- `HCR_HOOK_URL` — the deployed hook function. Must be `https`; the bot refuses to
  start otherwise, because the secret travels as a request header.
- `HCR_GATEWAY_SECRET` — the shared secret, sent as `x-hcr-gateway-secret`. The
  database stores only its SHA-256; the function hashes what it receives and
  compares digests, so plaintext never lands in the database.

`HCR_HOOK_AUTH` is **required**: it is the `Bearer` token for Supabase's own
gateway, which verifies a JWT before the function runs. Set it to the **anon
(publishable)** key — public by design and already shipped in the website's
JavaScript, so putting it here grants this machine nothing a visitor does not
already have. The bot refuses to start if either this or the gateway
secret looks like a service-role key — that key must never reach this machine.

Confirm the mode before you move on — `ls -l /etc/hcr-gateway.env` must show
`-rw------- root root`. The service account deliberately has no access to this file: systemd reads `EnvironmentFile` as PID 1 and passes the values in as environment, so the bot process never needs to open it. Giving `hcr-gateway` ownership would hand the bot's own uid write access to the Discord token — for nothing.

### About the bot token living on this machine

A gateway connection is authenticated by the bot token, so the token has to be on
this VM. There is no way around it. That is a real change in exposure and it is
worth being blunt about it:

**Anyone who can read that file can act as the league's bot** — read the full
member list, post to any channel, and manage roles up to the bot's permissions.
It is the same token the Supabase edge functions use, so it is not a lesser copy.

So:

- Keep the file at `0600` owned by `hcr-gateway`. Nothing else needs to read it.
- Keep SSH key-only (Oracle's Ubuntu images already disable password login —
  leave it that way) and do not add other users to this box.
- Turn on automatic security updates, then leave the machine alone:

  ```bash
  sudo apt-get install -y unattended-upgrades
  sudo dpkg-reconfigure --priority=low unattended-upgrades
  ```

- If this VM is ever compromised, or you delete or hand it on, **regenerate the
  bot token** in the Discord Developer Portal and update it in both places:
  `supabase secrets set DISCORD_BOT_TOKEN=...` and this env file.

### Rotating the shared secret

Only needed if the secret leaks or you want a fresh one:

```bash
openssl rand -base64 32                       # the new plaintext
printf %s 'THE-NEW-PLAINTEXT' | sha256sum     # the hash to store
```

Use `printf %s`, not `echo` — `echo` appends a newline, so you would be storing
the hash of a different string, after which every trigger is refused with 401 and
nothing else looks wrong. Store the 64-character hash:

```sql
update public.discord_config set gateway_secret_sha256 = 'the-64-hex-digits' where id = 1;
```

Put the new plaintext in `oracle-gateway/.gateway-secret` locally and in
`/etc/hcr-gateway.env` on the VM, then `sudo systemctl restart hcr-gateway`.

---

## 4. Oracle networking — open nothing

**This bot makes only outbound connections.** It opens a WebSocket to
`gateway.discord.gg` on 443 and makes HTTPS calls to Supabase on 443. It listens
on no port. Nothing on the internet ever connects *to* it.

So there is nothing to add to the VCN security list, and no ingress rule to
write. This is the step people over-do — a bot deployment feels like it should
need a port opened, so ingress gets widened to 0.0.0.0/0 on some port that
nothing is even listening on, and the box is left more exposed for no benefit.

The only inbound access you need is **SSH on port 22**, which Oracle's default
security list already allows. Leave the default egress rule (all traffic) alone —
that is what the bot actually uses.

Oracle's Ubuntu images also ship a local iptables ruleset. It permits all
outbound traffic, so there is nothing to change there either. If you find you
cannot SSH in, that is the security list's port 22 rule or your key — it has
nothing to do with this bot.

---

## 5. Start it, and prove it works

```bash
sudo cp /opt/hcr-gateway/hcr-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hcr-gateway
systemctl status hcr-gateway
```

You want `active (running)`. Then watch the log:

```bash
journalctl -u hcr-gateway -f
```

A healthy start logs two lines within a few seconds — `Starting the HCR Discord
gateway relay.` and `Connected to Discord as <bot>, watching server <id>.` — and
then goes quiet. Silence between events is correct; this process does nothing at
all until somebody joins or leaves. It should stay running indefinitely. If it is
restarting every ten seconds, see the troubleshooting table.

### Confirm a real join is now fast

The log alone does not prove the chain works end to end. Do this:

1. Have someone join the server — or use a second Discord account, or leave and
   rejoin yourself.
2. Watch `journalctl -u hcr-gateway -f`. You should see `Joined: <name>` at once,
   then `Triggered a membership refresh for ...` a couple of seconds later. The
   gap is deliberate: the bot holds a two-second window open so that four people
   joining together cost one refresh instead of four.
3. Watch `#welcome`. The welcome should appear **within a few seconds**. Before
   this bot it took up to two minutes.
4. Wait three more minutes and check `#welcome` again. There must be **no second
   welcome**. `discord-membership` records `welcomed_at`, so the cron run that
   follows sees the member as already greeted and posts nothing. If you do see a
   duplicate, stop the unit (§6) and say so — that guard is what keeps the relay
   and the cron from stepping on each other.
5. For a departure, have the test account leave and check the staff-only
   `#member-departures` channel. Same expectation: seconds, not minutes.

One thing that looks like a fault and is not: if you trigger two joins within ten
seconds of each other, the hook answers the second one with a "debounced" reply
rather than starting a second refresh. The refresh already running rolls the whole
member list, so it picks up both people anyway.

### When it does not work

The bot's own log lines are written to be read by a human, so start there. The
common ones:

| Symptom | Cause |
|---|---|
| `Cannot start: ...` and the unit is failed | A missing or malformed setting in `/etc/hcr-gateway.env`. The line names which one and what it wanted. |
| Close code `4004` | Wrong or rotated bot token. |
| Close code `4014` | **Server Members Intent** is off. Discord Developer Portal -> your app -> **Bot** -> enable it. Without it the gateway connects but never delivers a join or a leave, which looks like the bot working and doing nothing. |
| `The membership function refused this trigger (401)` | Either the secret does not match the stored hash — usually the `echo`-versus-`printf` newline trap in §3 — or `HCR_HOOK_AUTH` is missing or wrong, so Supabase's gateway rejected the call before the function ran. Check it holds the anon key (§3). |
| `HTTP 404` from the hook | Wrong slug in `HCR_HOOK_URL`. Check `supabase functions list`. |
| `Ignored guildMemberAdd in server ... — not the configured HCR server` | `HCR_GUILD_ID` is wrong. |
| `status` says *"start request repeated too quickly"* | The unit hit its restart limit and gave up on purpose, to stop burning Discord's daily IDENTIFY quota. Fix the underlying error, then `sudo systemctl reset-failed hcr-gateway && sudo systemctl start hcr-gateway`. Joins are still being handled by the cron meanwhile. |

A gateway disconnect is not a fault. `Gateway disconnected (code ...) —
reconnecting.` followed by `Gateway session resumed` is the connection doing what
it is supposed to do, and the process stays up throughout.

---

## 6. Rolling back

```bash
sudo systemctl disable --now hcr-gateway
```

That is the whole rollback. There is nothing to undo, nothing to redeploy and
nothing to restore.

**Everything keeps working.** The two-minute `pg_cron` job that invokes
`discord-membership` was never turned off and is not supposed to be. Welcomes and
departure reports carry on exactly as they did before this bot existed — just
back to up to two minutes late instead of instant.

This is the entire point of the design. The bot holds no state and makes no
decisions, so losing it costs latency and nothing else. The same is true if the
VM dies at 3am, if Oracle reclaims it, or if you never notice it stopped: the
league does not break, it just gets slower by two minutes.

If you are decommissioning the VM rather than pausing it, terminate the instance
and then regenerate the bot token (§3) — it lived on that disk.

**Do not switch the cron job off** to "save duplicate work". It is the safety
net, and the relay is deliberately nothing more than a way of saying "run that
cron job now, early".
