# KOS WL Bot — Complete Setup & Operations Guide

Everything you need to run, use, and deploy the bot and dashboard.

> **Paste tip:** your zsh treats `#` as text, not a comment. Paste commands
> **without** any trailing `# ...` notes, one block at a time.

---

## 0. What this is (architecture)

Three pieces share one PostgreSQL database:

```
Discord  ──▶  BOT (Node, discord.js)  ──┐
                                        ├──▶  PostgreSQL  ◀── DASHBOARD (Next.js)  ◀── you (browser)
Members  ──▶  slash commands/buttons  ──┘
```

- **Bot** — runs 24/7, handles raffles, draws winners, posts proofs, collects wallets.
- **Dashboard** — web UI to monitor raffles, export winners/wallets, manage blacklist.
- **Database** — Postgres (local for dev; Neon/managed for production).

Local ports: **bot internal API 4000**, **dashboard 3001** (Mintooor uses 3000).

Project location on your Mac: `/Users/adebayodaniel/KOS RAF`

---

## 1. Prerequisites

You already have these installed:
- Node (via Homebrew + nvm), **pnpm** (under nvm Node 22), PostgreSQL 16, git.

Make `pnpm` available in any terminal (run once):
```
echo 'export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
pnpm -v
```

---

## 2. PART A — Run it locally (development)

### A1. Install dependencies
```
cd "/Users/adebayodaniel/KOS RAF"
pnpm install
```

### A2. Local database (already done, shown for reference)
```
psql postgres -c "CREATE ROLE kos LOGIN PASSWORD 'kos';"
psql postgres -c "ALTER ROLE kos CREATEDB;"
psql postgres -c "CREATE DATABASE kos OWNER kos;"
```

### A3. Discord application setup
1. Go to https://discord.com/developers/applications → **New Application**.
2. **General Information** → copy **Application ID** = `DISCORD_CLIENT_ID`.
3. **Bot** → **Reset Token** → copy = `DISCORD_TOKEN`.
4. **Bot** → **Privileged Gateway Intents** → enable **Server Members Intent**.
5. **OAuth2** → copy/reset **Client Secret** = `DISCORD_CLIENT_SECRET` (for dashboard login).
6. **OAuth2 → Redirects** → add (for local dashboard login):
   `http://localhost:3001/api/auth/discord/callback`
7. Invite the bot: **OAuth2 → URL Generator** → scopes `bot` + `applications.commands`;
   bot permissions: View Channels, Send Messages, Embed Links, Attach Files,
   Read Message History, Use Slash Commands. Open the URL → add to your server.

### A4. Configure `.env`
Your `.env` already has generated secrets + your Discord token. Confirm/fill these
in `/Users/adebayodaniel/KOS RAF/.env` (edit with `nano .env`):

```
NODE_ENV=development
DATABASE_URL=postgresql://kos:kos@localhost:5432/kos
DISCORD_TOKEN=...your bot token...
DISCORD_CLIENT_ID=...application id...
DISCORD_GUILD_ID=...your server id...           (instant command updates)
WALLET_ENCRYPTION_KEY=...64 hex chars...
INTERNAL_API_TOKEN=...24+ hex chars...
INTERNAL_API_PORT=4000
DASHBOARD_URL=http://localhost:3001
BOT_INTERNAL_URL=http://127.0.0.1:4000
DASHBOARD_PASSWORD=...choose a strong one...
DASHBOARD_SESSION_TOKEN=...64 hex chars...
DISCORD_CLIENT_SECRET=...from OAuth2...
DASHBOARD_ALLOWED_USER_IDS=...your discord user id...
```

To find your Discord user ID: Discord → Settings → Advanced → enable Developer
Mode, then right-click your name → Copy User ID.

Generate any missing secrets:
```
openssl rand -hex 32
openssl rand -hex 24
```

### A5. Initialize the database + register commands
```
cd "/Users/adebayodaniel/KOS RAF"
pnpm db:generate
DATABASE_URL="postgresql://kos:kos@localhost:5432/kos" pnpm db:migrate:deploy
pnpm deploy:commands
```

### A6. Run it (two terminals)
Terminal 1 — bot:
```
cd "/Users/adebayodaniel/KOS RAF"
pnpm dev:bot
```
Terminal 2 — dashboard:
```
cd "/Users/adebayodaniel/KOS RAF"
cp .env apps/dashboard/.env.local
pnpm dev:dashboard
```
Open http://localhost:3001 and sign in (Discord or the password).

---

## 3. PART B — Using the bot in Discord

### Manager access
- Server owner, **Administrator**, and **Manage Server** can manage raffles already.
- Grant other roles: `/config managers add role:@Mods`
- Review config: `/config show`
- Set default channels: `/config channels announce:#winners proof:#proof`

### Create a raffle (popup flow)
1. Run `/raffle create` → a **form popup** opens:
   - Project name, Raffle title, WL spots
   - Start — `now`, or `2026-06-25 17:00`, or `tomorrow 5pm`
   - End — `24h`, `2d`, or `2026-06-26 17:00`
2. Submit → a **setup panel** appears (only you see it):
   - Dropdown: channel to **post** the raffle
   - Dropdown: **announce** channel (winners)
   - Dropdown: **proof** channel
   - Dropdown: **eligible roles** (pick 0–5; none = everyone)
   - **Match: ANY/ALL** toggle, then **Publish Raffle**.
3. The live embed posts with **Enter Raffle** / **Leave** buttons. It opens/closes
   on schedule automatically, draws winners, announces them, and ships a proof
   package (PDF + CSV + winner card) to the proof channel.

> Discord only allows text boxes inside a popup — channel/role pickers must be
> dropdowns, so they appear on the panel right after the form.

### Wallet registry (members save wallets once)
- Members: `/wallet set chain:Ethereum address:0x...` (or Base/Solana/Bitcoin),
  `/wallet view`, `/wallet remove`.
- Managers: `/wallet panel` posts a public **Register / Update Wallet** button
  (one popup for all chains). Pin it in a #wallets channel.
- When a member wins, their saved wallet is used **automatically** (no re-asking)
  and appears in the winner CSV + proof. Export all: `/wallet export`.

### Other manager commands
| Need | Command |
| --- | --- |
| End now & draw | `/raffle end id:<#>` |
| Reroll | `/raffle reroll id:<#> mode:single\|multiple\|all` |
| Re-post embed (after fixing perms) | `/raffle repost id:<#>` |
| Edit | `/raffle edit id:<#>` |
| List | `/raffle list` |
| Stats | `/raffle stats` |
| Export CSV | `/raffle export id:<#> type:winners\|participants` |
| Delete | `/raffle delete id:<#>` |
| Blacklist | `/blacklist add\|remove\|list` |

---

## 4. PART C — Using the dashboard
At http://localhost:3001 (or your Vercel URL):
- **Overview** — live raffles + stats (auto-refresh).
- **Raffles** — open one to see winners, export CSV, end, reroll.
- **Wallets** — registry stats + **Download CSV**.
- **Blacklist** — add/remove users.

---

## 5. PART D — Push to GitHub
Git is already initialized with commits (no secrets included).
1. Create an **empty private repo** at https://github.com/new (no README/license).
2. Push:
```
cd "/Users/adebayodaniel/KOS RAF"
git remote add origin https://github.com/YOUR_USERNAME/kos-wl-bot.git
git push -u origin main
```
If prompted for a password, use a **Personal Access Token** (GitHub → Settings →
Developer settings → Personal access tokens), not your login password.

---

## 6. PART E — Production database (Neon)
Vercel can't reach a local/EC2 Postgres, so use one shared managed DB.
1. https://neon.tech → new project → copy the connection string
   (`postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`).
2. Apply the schema from your laptop:
```
cd "/Users/adebayodaniel/KOS RAF"
DATABASE_URL="<your-neon-url>" pnpm db:migrate:deploy
```
3. Use this **same** `DATABASE_URL` for both the EC2 bot and Vercel dashboard.

---

## 7. PART F — Deploy the dashboard to Vercel
1. https://vercel.com → **Add New → Project** → import your GitHub repo.
2. **Root Directory:** `apps/dashboard`  (important).
3. Framework auto-detected (Next.js); build is preset via `vercel.json`.
4. **Environment Variables** (Settings → Environment Variables):
   - `DATABASE_URL` = your Neon URL
   - `DASHBOARD_SESSION_TOKEN` = same as the bot
   - `WALLET_ENCRYPTION_KEY` = **same as the bot** (or wallet export can't decrypt)
   - `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_GUILD_ID`
   - `DASHBOARD_ALLOWED_USER_IDS` = your Discord user id(s)
   - `DASHBOARD_PASSWORD` = a fallback password
   - `DASHBOARD_URL` = your Vercel URL (e.g. `https://kos-wl.vercel.app`)
5. **Deploy**. Then in Discord Developer Portal → OAuth2 → Redirects add:
   `https://<your-app>.vercel.app/api/auth/discord/callback`
6. Visit the URL → Sign in with Discord.

Note: dashboard **reroll/end** call the bot's API on EC2; until you expose that
publicly, do reroll/end in Discord. Everything else works off the database.

---

## 8. PART G — Deploy the bot to AWS EC2 (alongside Mintooor)

One small instance runs both. They don't collide (Mintooor 3000; KOS uses its
own DB + the bot's internal API on 4000). Use **t3.small** (2 GB); on a 1 GB
t3.micro add swap first.

### G0. (t3.micro only) add swap
```
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### G1. Tools (skip what Mintooor already has)
```
sudo apt update
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
. ~/.nvm/nvm.sh && nvm install 20 && nvm use 20
corepack enable && corepack prepare pnpm@9.12.0 --activate
npm i -g pm2
```

### G2. Timezone (so raffle Date/Time inputs are correct)
```
sudo timedatectl set-timezone Africa/Lagos
```

### G3. Get the code
```
cd ~ && git clone https://github.com/YOUR_USERNAME/kos-wl-bot.git kos-wl-bot
cd kos-wl-bot && pnpm install
```

### G4. Configure `.env` (uses the shared Neon DB)
```
cp .env.example .env
nano .env
```
Set (production):
```
NODE_ENV=production
DATABASE_URL=<your-neon-url>
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=...            (empty = usable in multiple servers)
WALLET_ENCRYPTION_KEY=...       (same as Vercel)
INTERNAL_API_TOKEN=...
INTERNAL_API_PORT=4000
DASHBOARD_URL=https://<your-app>.vercel.app
```

### G5. Register commands + start
```
pnpm deploy:commands
pnpm --filter @kos/bot build
pm2 start ecosystem.config.cjs --only kos-bot
pm2 save
pm2 startup
pm2 logs kos-bot
```
(You can also run `pm2 start ecosystem.config.cjs` to run the dashboard on EC2
too, but since it's on Vercel you only need `--only kos-bot`.)

### G6. Security group
Open **80/443** only. **Never** open 4000 or your DB port to the public.

---

## 9. PART H — Make both sides agree
- Same `DATABASE_URL` (Neon) on EC2 and Vercel → they share all data.
- Same `WALLET_ENCRYPTION_KEY` everywhere → wallet decryption works.
- Same `DASHBOARD_SESSION_TOKEN` → sessions valid across both.
- OAuth redirect registered for each URL you use (localhost + vercel.app).

---

## 10. PART I — Updating & maintenance
After you change code and push:
```
cd ~/kos-wl-bot && git pull
pnpm install
DATABASE_URL="<neon-url>" pnpm db:migrate:deploy
pnpm --filter @kos/bot build
pnpm deploy:commands
pm2 restart kos-bot
```
Vercel redeploys the dashboard automatically on each push to GitHub.

Backups (Neon has its own, but for manual):
```
pg_dump "<neon-url>" > backup-$(date +%F).sql
```

---

## 11. PART J — Troubleshooting
- **"command not found: pnpm"** → run the PATH export from section 1.
- **`cp: ... Not a directory`** → you pasted a `#` comment; remove it.
- **Slash commands not showing** → `pnpm deploy:commands`; with `DISCORD_GUILD_ID`
  set they're instant, otherwise global takes up to 1h. Reopen Discord.
- **"You don't have permission to manage raffles"** → you must be owner/Admin/
  Manage Server, or have a role added via `/config managers add`.
- **Raffle didn't post / "I'm missing X permission"** → the message names the exact
  permission + channel. Give the bot View Channel + Send Messages + Embed Links
  there, then `/raffle repost id:<#>`.
- **"Used disallowed intents" on bot start** → enable Server Members Intent in the
  portal.
- **Dashboard login fails after OAuth** → the redirect URL in the portal must
  exactly match `<DASHBOARD_URL>/api/auth/discord/callback`.
- **Wallet export shows `[encrypted]`** → `WALLET_ENCRYPTION_KEY` differs between
  bot and dashboard; make them identical.
- **Winner DMs not delivered** → that user has DMs closed; their wallet is still
  collected if they registered one, and you can export winners anyway.

---

## 12. PART K — Security checklist
- Never commit `.env` (already gitignored).
- Strong, unique `DASHBOARD_PASSWORD`; prefer Discord OAuth + `DASHBOARD_ALLOWED_USER_IDS`.
- Keep the bot's internal API (4000) and DB port closed to the internet.
- Rotate `DISCORD_TOKEN` if it ever leaks (Bot → Reset Token).
- Wallet addresses are AES-256-GCM encrypted at rest when `WALLET_ENCRYPTION_KEY` is set.

---

## Appendix — full `.env` reference
| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | bot + dashboard | Postgres connection |
| `DISCORD_TOKEN` | bot | Bot login token |
| `DISCORD_CLIENT_ID` | bot + dashboard | App id (commands + OAuth) |
| `DISCORD_CLIENT_SECRET` | dashboard | OAuth login |
| `DISCORD_GUILD_ID` | bot + dashboard | Instant commands + OAuth role checks |
| `WALLET_ENCRYPTION_KEY` | bot + dashboard | Encrypt/decrypt wallet addresses |
| `INTERNAL_API_TOKEN` | bot (+dashboard) | Auth for reroll/end API |
| `INTERNAL_API_PORT` | bot | Internal API port (4000) |
| `INTERNAL_API_HOST` | bot | Bind host (127.0.0.1; 0.0.0.0 only in Docker) |
| `DASHBOARD_URL` | bot + dashboard | Public dashboard URL (proof links + OAuth) |
| `BOT_INTERNAL_URL` | dashboard | Where to reach the bot API |
| `DASHBOARD_PASSWORD` | dashboard | Fallback login |
| `DASHBOARD_SESSION_TOKEN` | dashboard | Signs login sessions |
| `DASHBOARD_ALLOWED_USER_IDS` | dashboard | Who may sign in via Discord |
| `KOS_BRAND_NAME`, `KOS_LOGO_URL` | bot | Branding |

Powered by KOS.
