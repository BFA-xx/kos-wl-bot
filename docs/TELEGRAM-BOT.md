# KOS Telegram Bot

The official KOS Telegram bot is the Telegram interface for KOS identity,
communities, and KOS Raffle. It is independent from Mintooor. KOS Raffle stays
authoritative for raffle state, eligibility, entries, and winners.

## Runtime

- Framework: grammY with strict TypeScript.
- Production ingress: authenticated Next.js webhook at
  `/api/integrations/telegram/webhook`.
- Local ingress: guarded long polling through the same handler graph.
- Persistence: PostgreSQL with Prisma.
- Background raffle messages: existing durable `IntegrationDelivery` worker on
  EC2. Redis and BullMQ remain optional until a separate distributed workload
  needs them.

Telegram modules live under `apps/dashboard/lib/telegram`:

- `identity.ts`: immutable Telegram ID to provider-neutral KOS identity.
- `navigation.ts`: `/start`, `/menu`, `/profile`, `/admin`, deep links, and
  inline navigation.
- `community.ts`: group connection help and tagged new-member welcomes.
- `rate-limit.ts`: shared database-backed command/callback throttling.
- `format.ts`: safe HTML and strict deep-link parsing.
- `log.ts`: structured, secret-free Telegram logs.

## Identity

`KosIdentity` is the ecosystem identity root. `IdentityAccount` attaches stable
provider IDs for Telegram, Discord, X, website, Mintooor, and future products.
Telegram usernames are never identifiers or authorization evidence.

The optional `legacyUserId` points to the existing Discord-backed `User`. This
keeps all current KOS Raffle, points, wallet, and organization relations intact.
When a Telegram account is linked from the KOS profile, the identity bridge is
completed transactionally.

## Commands

- `/start`: create or open a KOS identity; accepts validated deep links.
- `/menu`: open private navigation.
- `/profile`: show a private, wallet-safe profile summary.
- `/admin`: show authorized KOS community settings.
- `/chatid`: show a Telegram group ID for organization setup.
- `/raffle publish <id>`: protected manual publication fallback. New hosted
  raffles publish automatically when configured.

## Configuration

Canonical production variables are:

```text
DATABASE_URL
TELEGRAM_BOT_TOKEN
TELEGRAM_BOT_USERNAME
TELEGRAM_WEBHOOK_SECRET
DASHBOARD_URL
```

`BOT_TOKEN`, `APP_URL`, and `WEBHOOK_SECRET` are accepted portable aliases.
`WEBHOOK_URL` is used by the local polling runner to restore a production-like
webhook on shutdown. Secrets must stay in protected environment storage.

For local polling:

```bash
TELEGRAM_LOCAL_POLLING=true pnpm --filter @kos/dashboard dev:telegram
```

Use a development bot token. Polling removes the active webhook while running;
set `WEBHOOK_URL` and `WEBHOOK_SECRET` so graceful shutdown restores it.

## Production Release

1. Validate and back up PostgreSQL before any schema migration.
2. Apply Prisma migrations before deploying code that uses new tables.
3. Deploy the Vercel dashboard/webhook.
4. Deploy the EC2 bot worker when shared database or raffle delivery code
   changes.
5. Register Telegram webhook allowed updates: `message`, `callback_query`, and
   `chat_member`.
6. Verify webhook protection, bot administrator status, update backlog, and
   EC2 scheduler health without creating production raffle data.

## Phase Boundaries

Phase 1 covers the bot foundation, KOS identity bootstrap, private menu and
profile summary, community configuration, tagged welcomes, permissions,
logging, and rate limiting. Onboarding rewards, full leaderboard/referrals,
quick-raffle conversations, and moderation commands remain later phases.
