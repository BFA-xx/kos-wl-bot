# Engineering Agent Guide

This file is the repository-level operating guide for an engineer or coding
agent taking over KOS.

## Project snapshot

KOS is a Discord-first whitelist raffle platform evolving into a reusable
community-engagement platform. The production product is Phase 3 S2.5 plus
the first S3/S4 slices. Phase 4 Collab Hub and its additive migration are live
on the production dashboard and EC2 bot:

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
- Organization-scoped Collab Hub CRM with overview analytics, Kanban/table/
  calendar views, partner directory, contacts, notes/comments, reminders,
  attachments, linked raffles, wallet submission tracking, exports, and bot
  automations.

Campaigns are still planned and not implemented.

The actual repository is `/Users/adebayodaniel/KOS RAF`. The remote is
`BFA-xx/kos-wl-bot`; the latest production verification was performed on
`main` at `3fa9204`.

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

Phase 4 adds organization-native `Collaboration`, `CollaborationPartner`,
`CollaborationRaffle`, `CollaborationWallet`, contacts, notes, comments,
attachments, activities, reminders, tags, and saved filters. A collaboration
links existing raffle/winner/wallet/proof records rather than copying them.
Wallet workflow rows store submission state and source references only; wallet
addresses remain encrypted in `Wallet`/`WalletProfile` and are resolved only
inside permission-checked exports. Manual wallet-list imports only reconcile
addresses that already match the member's registered encrypted profile; they
never overwrite member wallets. CRM attachments are private Vercel Blob
objects streamed through a tenant-checked API, and raw Blob URLs are omitted
from collaboration JSON. Proof PDF/CSV/PNG copies are encrypted before storage
in PostgreSQL and downloaded through organization-authorized artifact routes.

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
    flows for raffle-specific requirements. It also includes a separate,
    read-only recent-ended section; ended task actions stay disabled and the
    UI must say `Raffle ended` rather than looking like an unfinished entry;
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
- Dashboard raffle deletion requires `raffle:delete` and is database-mediated.
  The API immediately changes the raffle to `CANCELLED` and writes a
  `RAFFLE_DELETE_REQUEST` guild log. The bot scheduler consumes that request,
  removes the Discord raffle post, deletes EC2 proof files, writes the guild
  deletion audit, and finally deletes the database row. Do not make Vercel
  delete the Discord message or try to access bot-local proof paths.
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
- Organization participant IDs link to an internal member activity page. That
  page must first prove organization-scoped raffle, points, task, win, or
  reward activity; every subsequent query must stay scoped to the same guild
  IDs or organization ID. Wallet status additionally requires `wallet:view`,
  and wallet addresses remain in the dedicated Wallets surface.
- `Raffle.hideEntries` applies to completion output as well as the live raffle.
  Winner announcements and every delivered proof presentation (Discord embed,
  PNG, and PDF) must omit entry totals entirely. Do not substitute `Private`, a
  dash, or another placeholder that reveals an intentionally hidden field.
- Org raffle detail pages should render entry requirements as user-friendly
  cards, not raw `requirements` JSON.
- Community, raffle, and notification features shipped in S2.5.
- Member `/me/communities` distinguishes Discord communities the signed-in
  user belongs to from the complete KOS directory by comparing the OAuth
  `users/@me/guilds` response with organization `GuildConnection` rows. A
  failed lookup must show reconnect state rather than a false empty list.
- Community X branding is `Organization.xHandle`, validated from a handle or
  supported profile URL and rendered only as a public profile link. It is not
  X ownership or engagement verification.
- `SystemStatus["bot-heartbeat"]` is updated about once per minute; the admin
  health page considers it online for three minutes.
- Proof files live on the bot host and are delivered to Discord. Encrypted
  database copies make them portable to the authorized dashboard; the bot
  backfills existing local artifacts in bounded batches and regenerates them
  from raffle data without Discord delivery when a legacy stored path is no
  longer valid on EC2.
- Dashboard Vitest covers public raffle policy, duplication, tenant isolation,
  community membership, X branding, and Discord OAuth concurrency/rate-limit
  handling. Authenticated Playwright coverage includes desktop/mobile
  Communities and Branding visual baselines. Broader Discord/draw browser
  coverage is still missing, and the scheduler assumes one bot instance.
- Root `pnpm build` quotes workspace filters and builds DB, bot, and dashboard.
- Older public setup/deployment docs and `.env.example` lag Phase 2/3 and still
  emphasize the legacy internal API.
- Collab Hub additive migration `20260713100000_collab_hub` was applied before
  the dashboard/bot release. Preserve that migration-before-runtime ordering
  for future Collab Hub schema changes.
- Collab Hub is organization-native. Every read/write must include
  `organizationId`; attached raffle reads must additionally prove the raffle's
  `guildId` belongs to the organization's connected guilds.
- Collab Hub wallet exports require `collab:export`. Never persist or return a
  plaintext wallet address from general collaboration/detail APIs.
- Collab Hub history bootstrap is tenant-scoped and source-linking only. Its
  preview defaults to eligible ended raffles with entries and lets an
  authorized team explicitly opt into empty, cancelled, or test-named records.
  It groups repeated partner rounds by normalized project name or a narrowly
  shared X task identity and attaches the original raffles. Exceptional rows
  contribute no allocation unless they are ended, non-empty wins. It must never
  copy participants, winners, proofs, or wallet addresses into CRM data.
- Successfully published raffles in connected guilds must automatically gain a
  `CollaborationRaffle` link. The bot reuses an active same-partner campaign or
  creates a new tenant-scoped collaboration, and its minute sweep retries any
  published UPCOMING/LIVE/ENDED raffle missed by the immediate publish hook.
  Failed Discord publishes must not create collaboration records.
- Collab Hub is a relationship view, so repeated GTD/FCFS rounds may appear as
  one grouped collaboration card. Surface the all-time connected-raffle count
  separately and link teams to `/:org/raffles` when they need the one-row-per-
  raffle archive.
- The historical pairing heuristic treats an unlabeled same-project round as
  GTD when it is paired with an explicit FCFS round. A shared X handle may only
  bridge two normalized project-name variants so a community account cannot
  collapse unrelated partners.
- Collab Hub mobile views are intentionally distinct: the board is a stacked
  status feed, the spreadsheet stays horizontally scrollable, and the calendar
  is an agenda. The filter bar is not sticky below the desktop breakpoint, and
  the workspace switcher dismisses on scroll, resize, or Escape.
- Collab Hub presents `Collaboration.ownerId` as **Hosted by**. Assignment
  choices must be active organization team members; the organization owner is
  not implicitly an operational collaboration assignee. Historical imports use
  the attached raffle's `createdById`, so the displayed admin is the person who
  actually hosted the raffle rather than the person who ran the import.
- Historical raffle banners are media for the attached raffle, not partner
  logos or partner categories. Do not seed `CollaborationPartner.logoUrl` from
  a raffle banner or add a generic `Raffle partner` label. Raffle media uses a
  full-frame `object-contain` presentation and a branded fallback when its
  source is unavailable.
- Discord interaction attachment URLs under `ephemeral-attachments` expire.
  Older expired files cannot be recovered from their stored URL. Before a new
  Discord-uploaded banner is published, the bot must validate and copy at most
  5 MB into `RaffleBannerAsset`, replace `Raffle.bannerUrl` with the versioned
  public `/r/:id/banner` URL, and only then send the raffle post. Dashboard
  uploads continue to use Vercel Blob.
- Collaboration file downloads require `collab:view`; uploads/deletes require
  `collab:edit`. Store files as private Blob objects and never return their raw
  storage URL. Wallet CSV proof artifacts additionally require `collab:export`.

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
duplication behavior, tenant isolation, community discovery, and OAuth
resilience. Run authenticated community visual checks with
`pnpm --filter @kos/dashboard test:e2e`; credentials must stay outside Git.
Add focused tests for behavior changes and describe remaining manual
Discord/Vercel smoke checks.

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
