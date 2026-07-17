# Deploying KOS WL Bot on AWS EC2 (alongside Mintooor)

You can absolutely run KOS WL Bot on the **same EC2 instance** as Mintooor —
both are lightweight. They don't collide:

|                | Mintooor   | KOS WL Bot                               |
| -------------- | ---------- | ---------------------------------------- |
| Dashboard port | 3000       | **3001**                                 |
| Internal API   | —          | 4000 (localhost only)                    |
| Database       | its own DB | a separate `kos` DB on the same Postgres |

**Instance size:** `t3.small` (2 GB RAM) is comfortable for both. On a 1 GB
`t3.micro`, add 2 GB swap (below) or run `pnpm build` once and copy the output,
because Next.js builds are memory-hungry.

This guide uses **PM2** (same approach as your local run). A Docker alternative
is at the end.

---

## 0. (t3.micro only) add swap

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 1. Tools (skip what Mintooor already installed)

```bash
sudo apt update
# Node 20 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
. ~/.nvm/nvm.sh && nvm install 20 && nvm use 20
corepack enable && corepack prepare pnpm@9.12.0 --activate
# PM2, Postgres, Nginx (likely already present from Mintooor)
npm i -g pm2
sudo apt install -y postgresql nginx
```

## 2. Set the server timezone (so raffle Date/Time inputs are correct)

```bash
sudo timedatectl set-timezone Africa/Lagos   # use your timezone
```

## 3. Get the code onto the server

Easiest is a **private GitHub repo**. On your laptop:

```bash
cd "/Users/adebayodaniel/KOS RAF"
git init && git add . && git commit -m "KOS WL Bot"
git branch -M main
git remote add origin git@github.com:YOURNAME/kos-wl-bot.git
git push -u origin main
```

On the server:

```bash
cd ~ && git clone git@github.com:YOURNAME/kos-wl-bot.git kos-wl-bot
cd kos-wl-bot && pnpm install
```

(No GitHub? From your laptop:
`rsync -av --exclude node_modules --exclude .next "/Users/adebayodaniel/KOS RAF/" ubuntu@SERVER:~/kos-wl-bot/`)

## 4. Create the database (separate from Mintooor's)

```bash
sudo -u postgres psql -c "CREATE ROLE kos LOGIN PASSWORD 'STRONGPASS';"
sudo -u postgres psql -c "ALTER ROLE kos CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE kos OWNER kos;"
```

## 5. Configure `.env`

```bash
cp .env.example .env
nano .env
```

Set:

```
NODE_ENV=production
DATABASE_URL=postgresql://kos:STRONGPASS@localhost:5432/kos
DISCORD_TOKEN=...                 # your bot token
DISCORD_CLIENT_ID=...             # application id
DISCORD_GUILD_ID=                 # leave EMPTY for multi-server; set for single server
WALLET_ENCRYPTION_KEY=            # openssl rand -hex 32
INTERNAL_API_TOKEN=               # openssl rand -hex 24
DASHBOARD_URL=https://kos.yourdomain.com
BOT_INTERNAL_URL=http://127.0.0.1:4000
DASHBOARD_PASSWORD=               # a strong fallback password
DASHBOARD_SESSION_TOKEN=          # openssl rand -hex 32
DISCORD_CLIENT_SECRET=            # Developer Portal -> OAuth2 -> Client Secret
DASHBOARD_ALLOWED_USER_IDS=       # your Discord user id(s), comma-separated
```

Generate the secrets quickly:

```bash
echo "WALLET_ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "INTERNAL_API_TOKEN=$(openssl rand -hex 24)"
echo "DASHBOARD_SESSION_TOKEN=$(openssl rand -hex 32)"
```

Then give the dashboard its copy:

```bash
cp .env apps/dashboard/.env.local
```

## 6. Migrate, build, register commands

```bash
pnpm db:generate
DATABASE_URL="postgresql://kos:STRONGPASS@localhost:5432/kos" pnpm db:migrate:deploy
pnpm build
pnpm --filter @kos/bot deploy:commands -- --global
```

## 7. Start with PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # run the command it prints, to survive reboots
pm2 logs kos-bot   # confirm: "KOS WL Bot is online"
```

## 8. Nginx + HTTPS for the dashboard

Use a subdomain so it doesn't clash with Mintooor:

```bash
sudo cp infra/nginx/kos-wl-bot.conf /etc/nginx/sites-available/kos-wl-bot
sudo nano /etc/nginx/sites-available/kos-wl-bot   # set server_name kos.yourdomain.com
sudo ln -s /etc/nginx/sites-available/kos-wl-bot /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d kos.yourdomain.com
```

Point a `kos` DNS A-record at the instance's IP first. The provided config
proxies the dashboard (3001) only.

## 9. Discord OAuth redirect

In the Developer Portal → **OAuth2 → Redirects**, add exactly:

```
https://kos.yourdomain.com/api/auth/discord/callback
```

## 10. Security group

- Open **80** and **443** (likely already open for Mintooor).
- **Never** open **4000** (internal API) or **5432** (Postgres) to the world.

---

## Updating later

```bash
cd ~/kos-wl-bot && git pull
pnpm install
DATABASE_URL="postgresql://kos:STRONGPASS@localhost:5432/kos" pnpm db:migrate:deploy
pnpm build
cp .env apps/dashboard/.env.local
pnpm --filter @kos/bot deploy:commands -- --global # only if commands changed
pm2 restart kos-bot kos-dashboard
```

---

## Docker alternative (isolated)

If you'd rather isolate everything in containers:

```bash
# Install Docker, then:
cd ~/kos-wl-bot
cp .env.example .env && nano .env        # fill values (DATABASE_URL is overridden by compose)
# IMPORTANT when co-hosting: remove the "5432:5432" host port mapping under the
# postgres service in docker-compose.yml so it doesn't clash with Mintooor's DB.
docker compose up -d --build
docker compose exec bot pnpm --filter @kos/bot deploy:commands -- --global
```

Compose runs its own Postgres, the bot, and the dashboard (host port 3001).
Put the same Nginx subdomain config in front for TLS.
