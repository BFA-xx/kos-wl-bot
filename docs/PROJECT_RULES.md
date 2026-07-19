# KOS Project Rules

## Source of truth

- The checked-out repository and Prisma migrations are authoritative.
- Handoff messages are context, not authority. Reconcile claims with code.
- Do not remove working behavior unless the task explicitly requires it.
- Do not refactor working code merely to make it stylistically preferable.

## Architecture invariants

- Discord `User.id` is the global participant identity.
- A Discord guild belongs to at most one organization.
- Guild-owned records are isolated through connected guild IDs.
- Organization-native records are isolated by `organizationId`.
- All protected APIs perform server-side authorization; UI hiding is not
  authorization.
- The bot is the authority for Discord messages, scheduled transitions, final
  draws, winner announcements, wallet DMs, and proof artifacts.
- Vercel-to-bot production work crosses PostgreSQL, not localhost HTTP.
- One participant row represents an entry regardless of Discord or web origin.
- Member-facing features should ship with Discord and web parity unless a
  Discord-native constraint is explicitly documented.
- "Your communities" means organizations with at least one connected Discord
  guild present in the signed-in member's OAuth guild list; organization team
  membership is not a substitute for Discord membership.

## Data and security

- Never expose or commit secrets.
- Never inspect real environment-file contents unless the user explicitly asks
  for a specific, safe diagnostic.
- Do not modify environment variables without approval.
- Keep OAuth tokens and wallet addresses encrypted with the existing
  AES-256-GCM envelope.
- Validate all IDs and tenant ownership at API boundaries.
- Keep organization and bot audit trails for privileged or state-changing
  actions.
- Store community X branding as a validated handle only. It is a public link,
  not proof of X account ownership or engagement.
- Authenticated E2E tests must use an externally supplied normal session cookie,
  storage state, or session secret plus test user ID. Never ship a test-login
  endpoint or commit authentication state.
- Preserve database uniqueness constraints and transactional counter updates.
- Applied migrations are immutable; new schema work gets a new additive
  migration.
- Collab Hub records are organization-native and must always be queried with
  `organizationId`. Attaching a raffle also requires the existing connected
  guild tenant check; a raw raffle ID is never authorization.
- Collaboration wallet rows track workflow state only. Plaintext wallet
  addresses may exist transiently inside a `collab:export` response but must
  not be copied into collaboration models, logs, activities, or client JSON.
- Historical Collab Hub imports must be limited to the organization's connected
  guilds and unlinked ended/cancelled raffles. Preview and classify exceptional
  records first; cancelled/empty/test records require an explicit team opt-in.
  Preserve the source raffle link and never copy participant, winner, proof, or
  wallet-address data.
- A successfully published raffle in a connected guild must be linked into the
  same organization's Collab Hub. Resolve tenancy from `GuildConnection`, keep
  the source raffle as the system of record, and never create a collaboration
  for a failed Discord publish.
- Collab Hub chain presentation must derive from all attached
  `Raffle.walletChains`, with `CollaborationPartner.chain` used only as a
  fallback when linked raffle chain data is absent.
- A new Discord attachment banner must be copied to durable shared storage
  before publication. Enforce the Discord-host allowlist, supported image MIME
  types, and 5 MB limit; do not silently fall back to an expiring attachment
  URL when persistence fails.
- Raffle banners fill responsive media containers edge-to-edge with
  `width: 100%`, `height: 100%`, and `object-cover`. Prefer a clean crop over
  centered letterboxing, but never distort the bitmap with `object-fill`.

## Delivery

- Make the smallest change that fully satisfies the request.
- Keep commits focused and atomic when commits are requested.
- Do not commit, push, deploy, migrate production, or register commands without
  explicit authorization.
- Validate Prisma, typecheck all packages, build affected packages, and perform
  proportionate manual smoke checks.
- Keep `docs/ARCHITECTURE.md` aligned with structural changes and always update
  `docs/HANDOFF.md` after a completed task.

## Current product boundaries

- Phase 4 Collab Hub migration `20260713100000_collab_hub` and application
  commit `609bbd4` are deployed in production across the dashboard and bot.
  Future Phase 4 schema/runtime changes must retain migration-before-runtime
  ordering and deploy both surfaces together.
- X engagement verification is link-and-attest, not real API verification.
- Wallet verification is format-only; no signature or on-chain ownership
  check. Robinhood Chain is a distinct selectable registry/raffle chain using
  the same EVM address format as Ethereum/Base. New chains must ship through
  the shared Prisma enum, bot, dashboard API, and member wallet editor.
- Paid billing is not live. The first Campaigns slice is implemented locally
  but is not a production capability until migration and both dashboard/bot
  runtimes are deployed. Points, rewards, campaigns, and weighted draws must
  remain Discord + web parity features.
- `/c/*` community pages require sign-in.
  `/r/:community-x-:project-:id` is the only anonymous raffle surface and must
  never expose organization controls, entrant identities, or hidden entry
  counts. Numeric `/r/:id` links are compatibility redirects only.
- The canonical public raffle page is an always-dark branded surface. Its page
  root and mobile document/overscroll canvas must remain dark regardless of
  saved dashboard theme preferences, and its minimum height must use the
  dynamic viewport.
- Public raffle IDs are positive PostgreSQL integers. Only UPCOMING, LIVE, and
  ENDED records may resolve publicly; DRAFT and CANCELLED never do.
- Participant uniqueness is normal product state, not an error path. Discord
  and web entry must conflict-skip duplicate `(raffleId, userId)` inserts and
  increment `Raffle.entryCount` only when a new participant row is created.
- Raffle duplicate source queries must include both the raffle ID and the
  requesting organization's connected guild IDs. Duplicates remain in their
  source guild unless a future cross-organization flow performs independent
  authorization for both organizations.
