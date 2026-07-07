# Engineering Agent Guide

This file is the repository-level operating guide for an engineer or coding
agent taking over KOS.

## Project snapshot

KOS is a Discord-first whitelist raffle platform evolving into a reusable
community-engagement platform. The implemented product is Phase 3 S2.5:

- Discord raffle creation, entry, scheduling, winner draws, rerolls, wallet
  collection, announcements, and PDF/CSV/PNG proofs.
- Multi-tenant organization dashboards with roles, permissions, teams,
  connected guilds, analytics, reports, and super-admin controls.
- Participant `/me` area with Discord identity, X linking, wallets, history,
  task completion, community browsing, and notifications.
- Reusable Task Verification Engine attached to raffles.
- Web entry/leave using the same participant and winner tables as Discord.

S3 points/campaigns/rewards and S4 weighted draws are planned but do not exist
in the schema or application.

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
`TaskCompletion`, `RaffleTask`, and `Notification`.

Discord and web entry converge on unique `(raffleId, userId)` participants and
transactional `entryCount` updates. Gates cover blacklist, guild membership,
ANY/ALL eligible roles, extra roles, account/server age, wallets, and verified
raffle tasks. Reactions remain Discord-only. The bot can auto-verify same-guild
Discord tasks inline; the web uses Discord REST with the bot token.

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
- `TaskDefinition.points` is stored for S3 but currently awards nothing.

Wallet validation is format-only for Ethereum/Base, Solana, and Bitcoin.
Wallets and OAuth tokens reuse the AES-256-GCM `enc:v1` envelope and
`WALLET_ENCRYPTION_KEY`. Bot and dashboard must share the same key.

## Known state to preserve

- Billing is hidden from org navigation, but `/:org/billing` still exists.
- Both the new-raffle and edit UIs support verification-task selection. Raffle
  scalar, role, and task-gate edits are committed atomically.
- The member `/me/tasks` tab is the active-raffle workspace: it lists live
  raffles, renders attached Task Engine checks and legacy social/link raffle
  steps inline, and embeds the web entry panel. `/me/tasks?raffle=N` remains
  the focused one-raffle view.
- Org raffle detail pages should render entry requirements as user-friendly
  cards, not raw `requirements` JSON.
- Community, raffle, and notification features shipped in S2.5.
- `SystemStatus["bot-heartbeat"]` is updated about once per minute; the admin
  health page considers it online for three minutes.
- Proof files live on the bot host and are also delivered to Discord.
- There is no automated test suite and the scheduler assumes one bot instance.
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

The root `pnpm build` command is currently unreliable because its unquoted
workspace filter globs are shell-expanded. Until fixed, build packages
individually as above.

There are no automated tests. For behavior changes, add focused tests where
possible and describe any remaining manual Discord/Vercel smoke checks.

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
