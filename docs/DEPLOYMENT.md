# Deployment Guide

Two supported paths: **Docker** (simplest) and **VPS + PM2 + Nginx** (most control).

---

## Option A — Docker (recommended)

Requirements: Docker + Docker Compose plugin.

```bash
git clone <your-repo> kos-wl-bot && cd kos-wl-bot
cp .env.example .env
# Edit .env — at minimum:
#   DISCORD_TOKEN, DISCORD_CLIENT_ID
#   WALLET_ENCRYPTION_KEY   (openssl rand -hex 32)
#   INTERNAL_API_TOKEN      (openssl rand -hex 24)
#   DASHBOARD_PASSWORD, DASHBOARD_SESSION_TOKEN (openssl rand -hex 32)
# DATABASE_URL is set automatically by compose to the postgres service.

docker compose up -d --build
```

Compose starts three services: `postgres`, `bot`, `dashboard`.

- The bot container runs `prisma migrate deploy` on start, then launches.
- Register slash commands once:

```bash
docker compose exec bot pnpm deploy:commands
```

- Dashboard: `http://SERVER_IP:3001` (put Nginx + TLS in front for production).

Logs / lifecycle:

```bash
docker compose logs -f bot
docker compose logs -f dashboard
docker compose restart bot
docker compose down            # stop (keeps the pgdata + proofs volumes)
```

Proof artifacts persist in the `proofs` volume; database in `pgdata`.

---

## Option B — VPS (Ubuntu) with PM2 + Nginx

### 1. System packages

```bash
sudo apt update && sudo apt install -y curl git nginx postgresql
# Node 20 + pnpm
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable && corepack prepare pnpm@9.12.0 --activate
sudo npm i -g pm2
```

### 2. Database

```bash
sudo -u postgres psql -c "CREATE USER kos WITH PASSWORD 'strong-password';"
sudo -u postgres psql -c "CREATE DATABASE kos OWNER kos;"
# DATABASE_URL=postgresql://kos:strong-password@localhost:5432/kos
```

### 3. App

```bash
git clone <your-repo> /opt/kos-wl-bot && cd /opt/kos-wl-bot
cp .env.example .env && nano .env       # fill in everything
pnpm install
pnpm db:migrate:deploy
pnpm build
pnpm deploy:commands

# Dashboard env (Next reads from its own dir):
cp .env apps/dashboard/.env.local
```

### 4. Run with PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # follow the printed command to enable boot persistence
pm2 logs kos-bot
```

### 5. Nginx + TLS

```bash
sudo cp infra/nginx/kos-wl-bot.conf /etc/nginx/sites-available/kos-wl-bot
sudo ln -s /etc/nginx/sites-available/kos-wl-bot /etc/nginx/sites-enabled/
# edit server_name to your domain
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d dashboard.example.com
```

Only the dashboard (port 3001) is proxied. The bot's internal control API
(port 4000) stays bound to `127.0.0.1` — **never** expose it publicly.

---

## Upgrades

```bash
git pull
pnpm install
pnpm db:migrate:deploy
pnpm build
pm2 restart all          # or: docker compose up -d --build
```

## Backups

```bash
# Database
pg_dump "$DATABASE_URL" > backup-$(date +%F).sql
# Proof artifacts
tar czf proofs-$(date +%F).tgz generated/proofs
```

## Health checks

- Bot: `curl http://127.0.0.1:4000/internal/health` → `{"ok":true,"ready":true}`
- Dashboard: `curl -I http://127.0.0.1:3001` → `200/3xx`
