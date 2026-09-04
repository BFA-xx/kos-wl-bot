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
- `onboarding.ts`: completion and approval-activated onboarding rewards.
- `raffles.ts`: raffle discovery, entry history, and durable quick-raffle flow.
- `points.ts`: configurable, idempotent KOS points and leaderboards.
- `referrals.ts`: validated referral creation and completion.
- `admin.ts`: approval queue, moderation, announcements, and admin tools.
- `notifications.ts`: private notification preferences.
- `access.ts`: combined Telegram-admin and KOS-permission checks.
- `integrations.ts`: optional ecosystem event contracts; no Mintooor logic.
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

## Onboarding Approval

Anyone may start KOS Bot and create a provider-neutral KOS identity. A short,
resumable private flow verifies the Telegram session, creates the KOS identity,
offers optional profile and wallet connections, shows the community request,
and requires an explicit submission. Community access is not automatic.
Starting from a connected community welcome records a pending application.
Submission privately notifies eligible reviewers. A current Telegram
administrator with the KOS `member:manage` permission reviews it with
`/approvals` and explicit Approve/Reject buttons.

Leaving a connected Telegram group does not delete the member's KOS identity.
For a previously approved or rejected membership, `/start` and `/status`
surface an `Apply again` action. It reruns all five onboarding screens and only
opens a new pending review on final submission. Active, banned, and
already-pending memberships cannot be restarted. The new request timestamp
also creates a fresh, deduplicated private reviewer notification cycle.

Approval is scoped to the KOS community. Until it is approved, the member may
use the private bot but cannot enter that community's raffles or receive admin
point awards. Onboarding and referral rewards activate idempotently only after
approval.

## Commands

- `/start`: create or open a KOS identity; accepts validated deep links.
- `/menu`: open private navigation.
- `/profile`: show a private, wallet-safe profile summary.
- `/status`: show onboarding and community approval state.
- `/raffles`: browse active KOS Raffle publications.
- `/entries`: show the connected account's recent entries.
- `/points`: show global KOS points, level, and progress.
- `/leaderboard [week|month|all]`: show time-scoped rankings.
- `/invite`: create a personal KOS onboarding referral.
- `/notifications`: manage private notification preferences.
- `/admin`: show authorized KOS community settings.
- `/approvals`: privately review pending KOS community access requests.
- `/quickraffle`: privately create a validated KOS Raffle draft.
- `/settings`: privately open an authorized community's KOS settings.
- `/chatid`: show a Telegram group ID for organization setup.
- `/raffle publish <id>`: protected manual publication fallback. New hosted
  raffles publish automatically when configured.
- `/approvals`: group shortcut to the private approval queue.
- `/quickraffle`: group shortcut to the private durable quick-raffle flow.
- `/stats`, `/announce`, `/givepoints`, `/user`, `/settings`: protected KOS
  community administration.
- `/warn`, `/mute`, `/ban`, `/unban`: Telegram moderation with KOS audit rows.

## Community Greetings

When the connected community enables `GREETINGS`, KOS Bot replies directly to
human group messages containing `gm` or `gKOS` as standalone,
case-insensitive tokens:

```text
gKOS🖤
```

Messages such as `gm everyone`, `GM KOS`, and `well, gkos!` match. Embedded
letters in words such as `programming`, commands, bot messages, private chats,
and unconnected groups do not. Replies are silently limited to two per member
and fifteen per group per minute to stay below Telegram flood limits.

## Raffle Requirement Recovery

When a Telegram entry fails eligibility, KOS Bot privately sends the member a
named checklist instead of flattening repeated reasons into an alert. Task
gates share one `Complete raffle steps` link to the authenticated KOS member
panel; wallet/profile gates receive their own deduplicated actions. The message
keeps `Retry entry` for the same Telegram publication after the requirements
are verified. This preserves the established click-and-attest policy and does
not bypass roles, membership, age, wallet, task, or Discord-only gates.

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
7. Register private and group-admin command menus with
   `pnpm --filter @kos/dashboard telegram:commands`.

## Phase Boundaries

The integrated MVP now includes the Phase 1 foundation plus Phase 2 onboarding
and approval, Phase 3 KOS Raffle access and quick creation, Phase 4 global
points/levels/referrals, Phase 5 moderation/admin/preferences, and Phase 6
provider-neutral ecosystem event contracts. KOS Raffle remains authoritative;
Mintooor is an optional interface only and is not imported into this bot.
Failed external tasks include their direct provider URL as both an inline link
and a Telegram button. Keep the deduplicated KOS task-panel button as well:
opening the provider completes the action, while KOS records its verification.
