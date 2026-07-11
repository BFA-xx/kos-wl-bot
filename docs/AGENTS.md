# Engineering Agent Guide

This file is the repository-level operating guide for an engineer or coding
agent taking over KOS.

## Project snapshot

KOS is a Discord-first whitelist raffle platform evolving into a reusable
community-engagement platform. The implemented product is Phase 3 S2.5 plus
the first S3/S4 slices:

- Discord raffle creation, entry, scheduling, winner draws, rerolls, wallet
  collection, announcements, and PDF/CSV/PNG proofs.
- Multi-tenant organization dashboards with roles, permissions, teams,
  connected guilds, analytics, reports, and super-admin controls.
- Participant `/me` area with Discord identity, X linking, wallets, history,
  task completion, community browsing, and notifications.
- Reusable Task Verification Engine attached to raffles.
- Web entry/leave using the same participant and winner tables as Discord.
- Points ledger with member/org points pages, Discord/web task awarding, and a
  configurable Discord points channel.
- Rewards store with web and Discord redemption flows.
- Role-weighted raffles with participant weight snapshots and deterministic
  weighted draws.

Campaigns are still planned and not implemented.

The actual repository is `/Users/adebayodaniel/KOS RAF`. The remote is
`BFA-xx/kos-wl-bot`; the takeover audit was performed on `main` at `2542f6c`.

## Runtime and repository map

- `apps/bot`: long-running discord.js process on EC2/PM2. It owns Discord
  interactions, the scheduler, final draws/rerolls, Discord messages, wallet
  DMs, proof generation, and the database heartbeat.
- `apps/dashboard`: Next.js 14 App Router application on Vercel. It owns OAuth,
  organization/member UIs, API routes, task verification, and web entry.
- `packages/db`: Prisma 5 schema, migrations, generated client wrapper, seed,
  and the Phase 2 organization migration helper.
- `scripts/deploy-ec2.sh`: rsync/build/register/restart workflow for the bot.
- `infra/nginx`: older all-in-one VPS dashboard proxy example.

Both runtimes share PostgreSQL/Neon. Production dashboard-to-bot actions are
database-mediated because Vercel cannot call an EC2 localhost endpoint:

- Dashboard-created raffle: status `DRAFT`; scheduler publishes it.
- Dashboard edit: `editRequestedAt`; scheduler refreshes the Discord post.
- End now: status `LIVE` plus `endAt = now`; scheduler draws it.
- Reroll: `rerollRequest` plus `rerollRequestedAt`; scheduler consumes it.

The authenticated localhost bot control API still exists for local/legacy use,
but no production dashboard route calls `apps/dashboard/lib/bot.ts`.

## Identity, tenancy, and permissions

- `User.id` is the Discord snowflake and global participant identity.
- Discord OAuth stores encrypted access/refresh tokens and issues the signed,
  HTTP-only `kos_session` cookie.
- `ConnectedAccount` adds provider identities. X is live; Telegram/GitHub are
  reserved enum values.
- A guild belongs to at most one organization through unique
  `GuildConnection.guildId`.
- Guild-owned data must be scoped to the org's connected `guildIds`.
- Organization-native data such as tasks must be scoped by `organizationId`.
- Organization owners pass every permission; members use permission strings on
  `OrganizationRole`; super-admin uses `User.isSuperAdmin`.
- `requireUser`, `requireOrgAccess`, and `requireSuperAdmin` are the server-side
  authorization choke points.
- Middleware requires a session for all routes except login/auth and static
  assets. `/c/*` pages need no org membership but are not anonymous.

## Data model and flows

Core raffle models are `Guild`, `User`, `Raffle`, `RaffleRole`, `Participant`,
`Winner`, `WalletProfile`, `Wallet`, `Blacklist`, `Proof`, and guild `Log`.
Platform models are `Organization`, membership/role/invite models,
`GuildConnection`, `Subscription`, `AuditLog`, `Announcement`, `FeatureFlag`,
and `SystemStatus`. Phase 3 adds `ConnectedAccount`, `TaskDefinition`,
`TaskCompletion`, `RaffleTask`, `Notification`, `PointsLedger`, `RoleWeight`,
`Reward`, and `RewardRedemption`.

Discord and web entry converge on unique `(raffleId, userId)` participants and
transactional `entryCount` updates. Gates cover blacklist, guild membership,
ANY/ALL eligible roles, extra roles, account/server age, wallets, and verified
raffle tasks. Reactions remain Discord-only. The bot can auto-verify same-guild
Discord tasks inline; the web uses Discord REST with the bot token. Live
Discord raffle posts should refresh after actual enter/leave changes so entry
counts stay visible, but should not be edited on a timer just to tick
countdowns. Dashboard/web enter and leave flows should set `editRequestedAt` so
the bot scheduler can re-render the Discord post. Connected guilds can store
default channels for raffle posts,
winner announcements, proof delivery, and points/rewards activity; new raffle
builders should prefill from those defaults while still allowing per-raffle
overrides.

Draws generate a random 32-byte seed, store its SHA-256 commitment, rank each
candidate by `HMAC-SHA256(seed, userId)`, and persist the first N. The bot then
updates Discord, creates notifications, requests missing wallets, and generates
proof artifacts. Rerolls currently generate but do not persist a new seed.

Task verification behavior:

- X tasks require a linked X identity and then attest; no real engagement API
  verification is performed.
- Discord join/role tasks use live Discord REST checks when a bot token exists.
- Visit-link tasks attest immediately.
- Manual tasks enter the organization's review queue.
- `TaskDefinition.points` awards once per user/task through `PointsLedger`.
  Reward redemptions spend points through negative ledger rows and refunds use
  positive refund rows.

Wallet validation is format-only for Ethereum/Base, Solana, and Bitcoin.
Wallets and OAuth tokens reuse the AES-256-GCM `enc:v1` envelope and
`WALLET_ENCRYPTION_KEY`. Bot and dashboard must share the same key.

## Known state to preserve

- Billing is hidden from org navigation, but `/:org/billing` still exists.
- Both the new-raffle and edit UIs support verification-task selection. Raffle
  scalar, role, and task-gate edits are committed atomically.
- Org Settings includes default raffle channels per connected Discord server:
  raffle post, winners, and proof. The bot `/config channels` command exposes
  the same defaults, and Discord/web raffle creation should use them as
  prefilled defaults.
- Member profile IA is split deliberately:
  - `/me/raffles` is the raffle-entry panel with live raffle cards,
    `EntryPanel` checklists, and focused `/me/raffles?raffle=N` task/entry
    flows for raffle-specific requirements;
  - `/me/points` is the points/earning panel and embeds standalone point
    tasks only; raffle-specific tasks should not be shown there;
  - `/me/tasks` remains a hidden compatibility route for old deep links.
- Member mobile navigation should use the sidebar/drawer, not a cramped
  horizontal tab rail. The drawer must include a clear jump back to team/org
  dashboards.
- Keep member task cards compact and mobile-first: banners should render as
  natural-aspect media strips, not forced side columns or fixed crops; social
  tasks should use the one-CTA flow `Open task` -> `Verify` -> `Verified`.
- Current UI refresh direction is dark-mode premium SaaS: `#0A0A0A` background,
  `#111111` panels, `#181818` cards, subtle borders, blue/purple accents,
  generous spacing, visible focus states, and collapsible command-center
  navigation. Preserve that direction when adding points, rewards, campaigns,
  and weighted-role controls.
- Rewards and points must stay Discord + web parity features where technically
  possible. Current Discord commands are `/points`, `/tasks`, and `/rewards`;
  current web surfaces are `/:org/points`, `/:org/rewards`, `/me/points`,
  `/me/raffles`, `/me/tasks` as a compatibility route, and `/me/rewards`.
- Legacy social/link raffle steps are click-and-attest gates, not paid X API
  checks. They persist `SOCIAL_TASK_CLICK` / `SOCIAL_TASK_VERIFY` guild `Log`
  rows with a stable metadata `taskKey` and, when the task has a URL,
  `sharedTaskKey`; both web entry and bot entry check for verification before
  allowing entry. Same-link legacy tasks should satisfy each other across live
  raffles once opened/verified.
- Discord raffle task verification feedback should name the exact raffle/project
  and retry entry for that same raffle, so members are never pushed into a
  generic multi-raffle task context.
- Normalize external/task URLs at the dashboard API boundary and again before
  building Discord embeds/components. Discord rejects link buttons containing
  leading or trailing whitespace with error `50035`, which otherwise causes a
  dashboard-created raffle to be marked `CANCELLED`.
- Dashboard reposts for unexpired cancelled raffles should queue the existing
  DB-mediated publish flow by returning the raffle to `DRAFT`; do not call the
  bot's localhost control API from Vercel or duplicate participant/draw data.
- `/r/:id` is the canonical anonymous raffle URL. Keep `/c/:slug` session-gated,
  keep entry APIs authenticated, and pass `/r/:id` through Discord OAuth's safe
  `next` return when a signed-out visitor joins.
- Raffle duplication is configuration-only. Reuse the duplicate blueprint and
  variant helpers, preserve custom `requirements`, and never clone participants,
  winners, entry counts, message IDs, proof/draw fields, timestamps, or
  analytics.
- Successful Discord raffle entry feedback must be shown in the member's
  ephemeral interaction response, not by changing the public raffle button to a
  per-user state. The public Discord message is shared by all members; use
  disabled per-user components such as `Raffle entered ✓` for confirmation.
- Org raffle detail pages should render entry requirements as user-friendly
  cards, not raw `requirements` JSON.
- Community, raffle, and notification features shipped in S2.5.
- `SystemStatus["bot-heartbeat"]` is updated about once per minute; the admin
  health page considers it online for three minutes.
- Proof files live on the bot host and are also delivered to Discord.
- Focused dashboard tests cover public raffle policy, duplicate scheduling, and
  duplicate-route tenant isolation. Broader browser/integration coverage is
  still missing, and the scheduler assumes one bot instance.
- Root `pnpm build` is currently broken by shell expansion; individual package
  builds pass.
- Older public setup/deployment docs and `.env.example` lag Phase 2/3 and still
  emphasize the legacy internal API.

## Before changing code

1. Read `docs/HANDOFF.md`, `docs/ARCHITECTURE.md`, and
   `docs/PROJECT_RULES.md`, then consult `docs/DECISIONS.md` before changing an
   established architectural choice.
2. Run `git status --short --branch`; preserve unrelated user changes.
3. Inspect the concrete implementation before trusting older docs or chat
   handoffs. The repository is authoritative.
4. Do not read, print, commit, or rewrite `.env`, `.env.ec2`,
   `apps/dashboard/.env.local`, or `apps/dashboard/.env.vercel`.
5. Explain the intended change and current state before modifying application
   logic.

## Project conventions

- pnpm monorepo, Node 20+; the working machine currently has pnpm 9.12.0 under
  Node 22.
- TypeScript is strict. Preserve existing App Router, Prisma, SWR, discord.js,
  and service/module boundaries.
- Use `@/` imports inside the dashboard, `.js` suffixes for relative imports in
  bot ESM source, and Prisma enums/types rather than duplicate strings where
  practical.
- Keep migrations additive. Never edit an applied migration; add a new one.
- Use the existing AES-256-GCM format for secrets and wallets.
- Preserve tenant isolation: every org API must scope by `organizationId` or
  `ctx.guildIds`; never trust a raw client ID.
- `/api/me/tasks` returns both standalone `taskGroups` and live raffle
  workspaces. Route standalone earning tasks to `/me/points`; route
  raffle-specific entry tasks to `/me/raffles?raffle=N`.
- Preserve the Discord/web parity rule for member-facing functionality.
- Keep bot-bound dashboard actions database-mediated; Vercel cannot call EC2
  localhost.
- Avoid unrelated refactors. Match the existing compact style and naming.

## Verification

Use the project pnpm, not an arbitrary global pnpm that may try to purge
`node_modules`:

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
pnpm typecheck
DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder \
  pnpm --filter @kos/db exec prisma validate --schema=prisma/schema.prisma
pnpm --filter @kos/db build
pnpm --filter @kos/bot build
DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder \
  pnpm --filter @kos/dashboard build
```

The root `pnpm build` command quotes its workspace filter globs and builds the
DB, bot, and dashboard. Package-specific commands remain useful during focused
development.

Dashboard Vitest coverage currently focuses on public raffle policy,
duplication behavior, and tenant isolation. Add focused tests for behavior
changes and describe remaining manual Discord/Vercel smoke checks.

## Deployment boundaries

- Do not deploy, migrate production, push, or commit unless explicitly asked.
- Never alter environment variables or rotate secrets without approval.
- Database migrations require an explicit production plan and backup awareness.
- Bot deploys use `scripts/deploy-ec2.sh`; dashboard deploys via Vercel/GitHub.
- Slash commands must be re-registered only when command definitions change.

## Task completion

At the end of every completed engineering task:

1. Update `docs/HANDOFF.md`.
2. List every modified file.
3. State assumptions.
4. State technical debt discovered.
5. Recommend the next logical task.
6. Report verification performed and anything not verified.
