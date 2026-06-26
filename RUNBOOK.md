# KOS WL Bot — Runbook (when something goes wrong)

Your live setup:
- **Bot** → EC2 (`ubuntu@34.207.252.118`), managed by **pm2** as `kos-bot`.
- **Dashboard** → Vercel (`kos-wl-bot-dashboard-3a8x.vercel.app`).
- **Database** → Neon (shared by both).

Connect to the server:
```
ssh -i ~/Downloads/kosraf.pem ubuntu@34.207.252.118
```
> If `pm2`/`pnpm`/`node` "command not found" right after SSH, run:
> `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`

---

## Deploy a code update (from your Mac)
```
./scripts/deploy-ec2.sh
```
That syncs your local code, rebuilds, re-registers commands, restarts, and prints
the health check. (Edit code locally → run this → done.)

The **dashboard** redeploys itself automatically whenever you push to GitHub.

---

## Quick health checks (on the server)
```
pm2 ls                         # is kos-bot "online"? (high ↺ = crash loop)
pm2 logs kos-bot --lines 50    # recent logs (Ctrl+C to exit)
curl -s http://127.0.0.1:4000/internal/health   # {"ok":true,"ready":true}
pm2 monit                      # live CPU / memory
```

---

## Common problems & fixes

### Bot is offline / keeps restarting
```
pm2 logs kos-bot --err --lines 50      # read the actual error
pm2 restart kos-bot
```
- **"Used disallowed intents"** → enable **Server Members Intent** in the Discord
  Developer Portal → your app → Bot.
- **Can't reach database / P1001** → Neon may be paused or the URL changed. Check
  `~/kos-wl-bot/.env` `DATABASE_URL`, then `pm2 restart kos-bot`.
- **Out of memory ("Killed") during build** → add swap (one time):
  ```
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```

### A raffle won't post ("I'm missing … in #channel")
This is a real Discord permission. In the server: **Edit Channel → Permissions →**
add the bot (or its role) → allow **View Channel, Send Messages, Embed Links,
Attach Files**. Then in Discord run `/raffle repost id:<#>`.

### Slash commands missing or outdated
```
cd ~/kos-wl-bot && export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
pnpm deploy:commands
```
(Instant for your guild; reopen Discord if needed.)

### Need to fix raffle data directly
```
cd ~/kos-wl-bot && export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
DATABASE_URL="<your-neon-url>" pnpm db:studio
```
Opens Prisma Studio (a spreadsheet-like DB editor) — but prefer `/raffle edit`
in Discord for normal changes.

### Dashboard shows an error
- Vercel → your project → **Deployments** → open the latest → **Build/Runtime
  logs**. Most issues are a missing/incorrect env var (Settings → Environment
  Variables) — fix it and **Redeploy**.

---

## Roll back a bad deploy
The previous build is still in git. On your Mac:
```
cd "/Users/adebayodaniel/KOS RAF"
git log --oneline -5            # find the last good commit hash
git revert <bad-commit>         # or: git reset --hard <good-commit>
./scripts/deploy-ec2.sh
```
For the dashboard: Vercel → Deployments → pick a previous good one → **Promote to
Production**.

---

## Reboot / server maintenance
pm2 is set to auto-start the bot on reboot (`pm2 save` + `pm2 startup` were run).
If after a reboot the bot is down:
```
ssh -i ~/Downloads/kosraf.pem ubuntu@34.207.252.118
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
pm2 resurrect || (cd ~/kos-wl-bot && pm2 start ecosystem.config.cjs --only kos-bot && pm2 save)
```

## Backups
Neon keeps automatic backups, but for a manual snapshot (from your Mac or server):
```
pg_dump "<your-neon-url>" > backup-$(date +%F).sql
```

## Emergency stop / start
```
pm2 stop kos-bot      # take the bot offline
pm2 start kos-bot     # bring it back
```
