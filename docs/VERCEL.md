# Deploy the dashboard on Vercel

The split that works best:

- **Bot** → EC2 (needs a always-on process + Discord gateway). See `EC2-DEPLOYMENT.md`.
- **Dashboard** → Vercel (serverless).
- **Database** → one **shared** Postgres both can reach. On a laptop/EC2-local
  Postgres, Vercel can't connect, so use a managed Postgres like **Neon**
  (free) or Supabase. Point the bot AND the dashboard at the same `DATABASE_URL`.

> ⚠️ Set the **same `WALLET_ENCRYPTION_KEY`** on the bot and the dashboard, or
> the dashboard can't decrypt wallet addresses for export.

---

## 1. Create a shared database (Neon)

1. Sign up at neon.tech → create a project → copy the connection string
   (looks like `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`).
2. Apply the schema to it from your laptop:

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd "/Users/adebayodaniel/KOS RAF"
DATABASE_URL="<your-neon-url>" pnpm db:migrate:deploy
```

3. Use this same `DATABASE_URL` in the EC2 bot's `.env` too.

## 2. Push to GitHub (see push steps in chat)

## 3. Import into Vercel

1. vercel.com → **Add New… → Project** → import your GitHub repo.
2. **Root Directory:** `apps/dashboard`  ← important (monorepo).
3. Framework: **Next.js** (auto-detected). Leave build/install as default —
   `vercel.json` already sets the build to generate Prisma + `next build`.

## 4. Environment variables (Vercel → Project → Settings → Environment Variables)

| Key | Value |
| --- | --- |
| `DATABASE_URL` | your Neon URL |
| `DASHBOARD_SESSION_TOKEN` | same value as the bot (`openssl rand -hex 32`) |
| `WALLET_ENCRYPTION_KEY` | **same** as the bot |
| `DISCORD_CLIENT_ID` | your application id |
| `DISCORD_CLIENT_SECRET` | from Developer Portal → OAuth2 |
| `DISCORD_GUILD_ID` | your server id (for OAuth role checks) |
| `DASHBOARD_ALLOWED_USER_IDS` | your Discord user id(s), comma-separated |
| `DASHBOARD_PASSWORD` | a fallback password |
| `DASHBOARD_URL` | your Vercel URL, e.g. `https://kos-wl.vercel.app` |
| `BOT_INTERNAL_URL` *(optional)* | only if reroll/end from the dashboard (see note) |
| `INTERNAL_API_TOKEN` *(optional)* | same as bot, if exposing its API |

## 5. Deploy, then finish OAuth

1. Click **Deploy**. Note the assigned URL (e.g. `https://kos-wl.vercel.app`).
2. Set `DASHBOARD_URL` to that URL (if you guessed wrong) and redeploy.
3. Discord Developer Portal → **OAuth2 → Redirects** → add:
   `https://<your-app>.vercel.app/api/auth/discord/callback`
4. Visit the URL → **Sign in with Discord**.

## Note on reroll / end from the dashboard

Those two actions call the bot's internal API, which lives on EC2 (localhost).
Vercel can't reach it unless you expose it publicly (behind the bearer token /
Nginx). Until then, do **reroll/end in Discord** with `/raffle reroll` and
`/raffle end`. Everything else on the dashboard (monitoring, participants,
winners, CSV exports, wallet registry, blacklist) works over the database and
needs no bot connection.

## Custom domain (later)

Vercel → Project → **Domains** → add your domain and follow the DNS steps, then
update `DASHBOARD_URL` and the Discord OAuth redirect to the new domain.
