# KOS WL Bot

A premium NFT **whitelist raffle** management system for Discord communities —
role-gated entries, live embeds, automatic scheduling, cryptographically
verifiable winner draws, full proof packages (PDF + CSV + winner card), secure
wallet collection, anti-alt protection, and a black-and-white management
dashboard.

> Premium · Minimal · NFT-native. Black `#000000`, white `#FFFFFF`, silver
> accents. **Powered by KOS.**

---

## ✦ Features

| Area | What it does |
| --- | --- |
| **Role-based entry** | Single / multiple eligible roles, with `ANY` or `ALL` match modes. |
| **Raffle creation** | `/raffle create` with project, title, spots, roles, start/end, channels, banner, link, anti-alt rules. |
| **Premium embeds** | Live status (Upcoming / Live / Ended), countdown, entry count, odds, Enter / Leave buttons. |
| **Entry verification** | Eligibility + blacklist checks, duplicate prevention (DB-level), entry snapshots. |
| **Live tracking** | Embeds auto-refresh entries, time remaining, and status. |
| **Auto scheduling** | Opens at start, closes at end, locks entries, draws winners — no manual action. |
| **Winner selection** | Crypto-secure, **verifiable** draw (HMAC over a committed random seed); no duplicates. |
| **Announcements** | Auto-posts winners with real pings. |
| **Proof system** | Auto-generates a PDF report, winner CSV, and a premium PNG winner card, delivered to a proof channel. |
| **Wallet collection** | DMs winners a wallet form (ETH / SOL / BTC); addresses validated and **encrypted at rest**. |
| **Anti-alt** | Min account age, min server age, required roles, required reaction; suspicious-account flagging. |
| **Blacklist** | `/blacklist add\|remove\|list`; blocked users can't enter. |
| **Reroll** | `/raffle reroll` — single, multiple, or entire pool; fully logged. |
| **Admin commands** | create / edit / delete / end / reroll / list / stats / export, gated by manager roles. |
| **Audit logging** | Every meaningful action is written to an immutable log table. |
| **Dashboard** | Next.js + Tailwind: overview, raffles, participants, winners, reroll, blacklist, CSV export, live polling. |

---

## ✦ Tech stack

- **Bot:** Node.js 20+, TypeScript, discord.js v14, Prisma ORM
- **Database:** PostgreSQL
- **Proofs:** `pdfkit` (PDF), `@napi-rs/canvas` (winner card PNG), built-in CSV
- **Dashboard:** Next.js 14 (App Router), Tailwind CSS, SWR
- **Deploy:** Docker / docker-compose, PM2, Nginx

---

## ✦ Monorepo layout

```
kos-wl-bot/
├─ apps/
│  ├─ bot/                 # Discord bot (discord.js v14)
│  │  └─ src/
│  │     ├─ commands/      # /raffle, /blacklist slash commands
│  │     ├─ interactions/  # buttons, wallet modal, router
│  │     ├─ services/      # raffle, entry, winner, proof, wallet, scheduler…
│  │     ├─ embeds/        # KOS-themed embed builders
│  │     ├─ proof/         # pdf.ts, card.ts, csv.ts
│  │     ├─ http/          # internal control API (reroll/end for dashboard)
│  │     └─ utils/         # crypto, random (verifiable draw), time, rate limit
│  └─ dashboard/           # Next.js + Tailwind management UI
├─ packages/
│  └─ db/                  # Prisma schema + shared client (@kos/db)
├─ infra/nginx/            # reverse-proxy config
├─ docker-compose.yml
├─ ecosystem.config.cjs    # PM2
└─ docs/                   # setup / deployment / security / architecture
```

---

## ✦ Quick start (local)

```bash
# 0. Requirements: Node 20+, pnpm 9, a PostgreSQL database
pnpm install

# 1. Configure
cp .env.example .env
#   set DISCORD_TOKEN, DISCORD_CLIENT_ID, DATABASE_URL, WALLET_ENCRYPTION_KEY…
#   generate secrets:
#     openssl rand -hex 32   # WALLET_ENCRYPTION_KEY / DASHBOARD_SESSION_TOKEN
#     openssl rand -hex 24   # INTERNAL_API_TOKEN

# 2. Create the database schema
pnpm db:migrate        # dev: creates + applies a migration
pnpm db:generate

# 3. Register slash commands (set DISCORD_GUILD_ID for instant dev registration)
pnpm deploy:commands

# 4. Run
pnpm dev:bot           # the Discord bot
pnpm dev:dashboard     # the dashboard at http://localhost:3001
```

The dashboard reads its env from `apps/dashboard/.env.local` (Next.js
convention). For local dev, copy or symlink:

```bash
cp .env apps/dashboard/.env.local   # or: ln -s ../../.env apps/dashboard/.env.local
```

---

## ✦ Using it in Discord

1. Invite the bot (see [docs/DISCORD-SETUP.md](docs/DISCORD-SETUP.md)) — enable
   the **Server Members Intent**.
2. Grant a manager role (anyone with *Manage Server* / *Administrator* already
   qualifies). Configure manager roles via the `guilds.managerRoleIds` column or
   the seed script.
3. Create a raffle:

```
/raffle create
  project: ProjectX
  title: KOS x ProjectX WL
  spots: 5
  start: now
  end: 24h
  announce_channel: #winners
  proof_channel: #proof
  role1: @OG Holder
  role2: @Active Member
  match_mode: Any selected role can enter
```

The bot posts a live embed with **Enter Raffle** / **Leave** buttons, opens and
closes on schedule, draws verifiable winners, announces them, DMs wallet forms,
and ships a proof package to `#proof`.

Full command reference: [docs/COMMANDS.md](docs/COMMANDS.md).

---

## ✦ Deployment

- **Docker:** `cp .env.example .env && docker compose up -d --build`
- **VPS (PM2 + Nginx):** see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

---

## ✦ Documentation

- [docs/DISCORD-SETUP.md](docs/DISCORD-SETUP.md) — create the app, intents, invite
- [docs/COMMANDS.md](docs/COMMANDS.md) — every command + option
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Docker & VPS production deploy
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — data model, services, draw proof
- [docs/SECURITY.md](docs/SECURITY.md) — secrets, encryption, hardening

---

## ✦ Scripts

| Command | Description |
| --- | --- |
| `pnpm build` | Build all packages and apps |
| `pnpm dev:bot` / `pnpm dev:dashboard` | Run in watch mode |
| `pnpm deploy:commands` | Register slash commands with Discord |
| `pnpm db:migrate` / `db:migrate:deploy` | Apply migrations (dev / prod) |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm typecheck` | Type-check every package |

---

Powered by KOS.
