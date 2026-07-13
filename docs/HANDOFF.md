# Engineering Handoff

Last updated: 2026-07-13
Repository: `BFA-xx/kos-wl-bot`
Branch: `main`
Audited application commit: `d922ac0`

## Current state

Phase 3 is implemented through S2.5:

- S1: Discord-backed participant account, `/me`, X OAuth linking, history.
- S2: reusable task definitions/completions, org builder/review queue, raffle
  task gates, bot inline Discord-task verification.
- S2.5: web raffle entry/leave and gate checklist, member wallet CRUD,
  community directory/pages, winner/result/announcement notifications, member
  login routing.
- Follow-up: database-backed bot heartbeat and Billing hidden from org nav.
- Product UI refresh slices 1 and 2 are committed, pushed, and deployed.
- S3/S4 first slice is committed, pushed, migrated, and deployed: task points
  ledger, org/member points pages, role-weight manager, weighted raffle
  toggles, entry weight snapshots, and deterministic weighted draws.
- S3 rewards/points-channel slice is committed, pushed, migrated, and deployed:
  configurable Discord points channels, web reward store/management, and
  Discord commands for points, tasks, and rewards.
- Anonymous raffle sharing and configuration-only duplication are committed,
  pushed, and deployed on the production dashboard.
- Member-aware community discovery and optional community X branding are
  migrated and deployed.
- Organization-scoped member activity pages and community-branded Discord
  completion output are implemented and verified.
- The member Raffles tab now includes read-only ended history, and team raffle
  deletion is implemented through the database-mediated bot cleanup flow.
  Both dashboard projects and the EC2 bot are deployed.
- Phase 4 Collab Hub is implemented, migrated, committed, pushed, and deployed.
  Production migration `20260713100000_collab_hub` was applied on 2026-07-13,
  both Vercel dashboard projects report a successful deployment, and the EC2
  bot is healthy in two guilds.
- Collab Hub is populated from existing KOS raffle history: 50 eligible ended
  raffles are linked into 34 completed partner collaborations. Fourteen are
  multi-raffle groups, with same-partner GTD/FCFS rounds combined. Its
  responsive workspace polish and scroll-dismiss workspace switcher are
  deployed on the dashboard.
- Collab Hub history presentation is hardened and deployed: organization
  ownership is no longer shown as the collaboration host, imported records use
  the admin who created/hosted their attached raffle, completed/activity
  analytics cover all time, Completed is the third board column, generic
  partner labels are removed, and attached raffle media uses complete 16:9
  display with branded fallbacks for unavailable historical assets.
- The KOS production Collab Hub now links every retained raffle record. All 57
  ended raffles and both cancelled NUTSY repost attempts are attached to a
  collaboration (59/59 retained records); empty and test-era ended raffles were
  included on the owner's explicit request. Empty/cancelled records contribute
  zero WL allocation, KUON's early raffle is attached to the existing KUONnft
  collaboration, and the cancelled retries are attached to NUTSY instead of
  creating duplicate partner records.
- New hosted raffles now enter Collab Hub automatically after Discord accepts
  the post. Discord attachment banners are made durable before publication,
  history import has an explicit exceptional-row preview, Active is a real
  pipeline filter, and deletion removes untouched auto-created Hub residue.
- Robinhood Chain (`RH`) is deployed as a first-class wallet chain across team
  raffle create/edit, member web/Discord registration, eligibility, winner
  collection, duplication, and exports.

The original takeover workstream was **S2.5 hardening**. Two hardening slices
have been committed and pushed to `main`:

- raffle verification task gates can now be edited, relation replacement is
  atomic, and editing legacy social tasks preserves the other anti-alt
  requirements;
- the member Tasks area now acts as an active-raffle workspace, and the org
  raffle detail page renders entry requirements as clean cards instead of raw
  requirements JSON. A follow-up also renders legacy raffle social/link tasks
  (Follow/Like/Retweet/etc.) in the member Tasks cards. Those legacy tasks now
  require Open → Verify before web or Discord entry is allowed.

Claude reported the earlier S2.5 production database migration, bot online in
two guilds, and Vercel dashboard deployment. This takeover has now directly
verified the points/weighted migration, EC2 bot deployment, and Vercel route
availability described below.

## Verified locally

### Phase 4 Collab Hub — production release verified

- Added organization-scoped collaboration and partner CRM models, pipeline/
  priority/submission/wallet/reminder enums, contacts, notes, comments,
  attachments, activities, reminders, custom tags, saved filters, raffle
  links, and wallet workflow rows.
- Added `collab:view/create/edit/assign/export/archive` permissions and migrated
  expected grants for existing system roles without changing custom roles.
- Added `/:org/collabs` with six headline metrics, search/filter/saved-filter
  controls, drag-and-drop board, responsive spreadsheet, calendar, bulk
  actions, CSV export, partner directory, recent activity/deadlines/notes, and
  collaboration analytics.
- Added `/:org/collabs/:id` with editable Overview, Timeline, Requirements,
  Wallet Collection, Raffles & Proof, Contacts, Notes, Files, Activity, and
  Comments sections. Notes/comments/contacts can be added, edited, and removed;
  comments support team mentions, notes can be pinned, and supported files are
  stored in Vercel Blob.
- Raffles can be attached or created from a collaboration. New raffles still
  use the existing DRAFT/database-mediated publish path and automatically move
  their collaboration to Hosting.
- Winner and reusable wallet data is reconciled without copying addresses.
  CSV/XLSX/TXT exports require `collab:export`, resolve the encrypted source at
  response time, and move exported wallet rows/the collaboration to Submitted.
- The bot performs a throttled collaboration sweep, syncs after raffle draws,
  advances Hosting → Collecting Wallets → Ready for Submission, creates
  inactivity reminders, and sends due reminders through existing in-app
  notifications.
- Collaboration files now use private Vercel Blob uploads and authorized
  streaming downloads; raw storage URLs are omitted from detail responses.
- Notes now use a sanitized visual rich-text editor. Wallet Collection accepts
  CSV/TXT reconciliation against registered member wallets with row feedback.
- Proof PDF/CSV/PNG packages now have encrypted database copies for authorized
  dashboard downloads, plus bounded legacy EC2 artifact backfill. If an older
  row points at a path from another host, the bot regenerates the package from
  raffle data without sending another Discord proof message.
- Active collaboration automation uses a durable keyset cursor and reminder
  batches continue under a time budget instead of silently stopping at a fixed
  first page.
- Added focused tenant-isolation, workflow, wallet-import, and rich-text tests.
  Dashboard suite is 39 tests across 14 files; bot presentation suite remains
  2 tests.
- Prisma validates; dashboard and bot typechecks pass; DB, bot, and Next.js
  production builds pass; `git diff --check` passes.

Production release evidence:

1. Production migration is applied and `prisma migrate status` reports current.
2. Application commits `ab5d995` and `609bbd4` are pushed to `origin/main`.
3. Both Vercel commit statuses succeeded and the primary production route is
   `https://raffle.koslabs.app/:org/collabs`.
4. The EC2 bot rebuilt, registered seven slash commands, restarted under PM2,
   returned `{"ok":true,"ready":true}`, and reported two connected guilds.
5. All 57 production proof rows now contain portable encrypted artifacts; no
   proof row remains pending backfill.
6. Authenticated production QA loaded the Collab Hub, opened the three-step
   creation flow without writing a record, verified the mobile navigation and
   responsive breakpoint, found no horizontal overflow after layout settled,
   and recorded zero browser console errors.

### Collab Hub history and mobile hardening — production verified

- Removed the `Phase 4 · Relationship operations` eyebrow and the `1/2/3`
  labels from Board, Spreadsheet, and Calendar. View controls now expose their
  selected state accessibly and render visibly different projections even on
  small screens.
- The filter bar is only sticky on desktop. Mobile uses an on-demand two-column
  filter panel, equal-width view controls, a stacked status board, and a
  calendar agenda. Production QA at a narrow viewport measured no horizontal
  overflow and `position: relative` for the filter bar.
- The organization workspace switcher now dismisses on any captured scroll,
  resize, or Escape. Production QA confirmed a scroll closes the switcher while
  leaving the mobile navigation drawer open.
- Added the permission-checked, tenant-scoped
  `POST /api/:org/collaborations/import-history` bootstrap. A production dry
  run found 50 eligible raffles and 34 partner groups; the live import created
  34 partners, 34 completed collaborations, 50 source-raffle links, 34 import
  activities, and 376 address-free wallet workflow rows.
- Fourteen groups contain repeated raffle rounds. Verified pairs include
  VOLTOADS, PIXELATOR, GomeJpeg, SESAME, Mochimons, NUTSY, and others; each
  pair/group resolves to one collaboration. Cancelled raffles #59/#60,
  zero-entry raffles, and test records were not linked.
- Application commits `cbb12c3`, `432d2cb`, and `7030fd2` are on `origin/main`.
  Both Vercel dashboard projects report successful deployments for the audited
  application commit.
- Dashboard validation passes: 39 tests across 14 files, TypeScript, the
  production Next.js build, and `git diff --check`.

### Current assumptions

- An ended raffle with at least one entry represents useful collaboration
  history; cancelled, empty, and explicitly named test raffles do not.
- An older unlabeled raffle paired with an explicit same-project FCFS round is
  the GTD half of that relationship.
- A shared X task identity may bridge at most two normalized project names.
  Handles shared across more projects are treated as community-wide signals,
  not partner identity.

### Current technical debt

- Historical grouping is deterministic but heuristic. A partner that changed
  both its project name and X identity will remain split; two truly distinct
  names that share one X identity could require a manual split. There is not
  yet a partner merge/split review tool.
- Forty historical raffle banners were stored as Discord interaction
  `ephemeral-attachments` URLs and have expired. Their original bytes cannot be
  recovered from those URLs or the published Discord embeds. The UI shows a
  project-branded fallback; migration `20260713230000_raffle_banner_assets`
  and pre-publication persistence prevent this historical gap from growing.

The previously listed Phase 4 release-blocking implementation debt remains
closed; the historical review workflow above is the current follow-up.

### Collab Hub host, history, and media hardening — production verified

- Renamed every collaboration-facing Owner label to Hosted by and restricted
  assignment choices/validation to active organization members. The
  organization owner keeps authorization ownership but is not silently added
  to the operational team list.
- Applied data migration `20260713190000_collab_team_import_cleanup`. All 34
  generic `Raffle partner` categories and banner-derived partner logos were
  removed without touching manually supplied branding. Follow-up migration
  `20260713200000_collab_raffle_host_assignment` attributes all 34 imported
  collaborations to the active admin stored on their attached raffle.
- Completed summary now reports all-time completed records, and the activity
  chart spans the first collaboration month through the current month with
  year-qualified labels and horizontal overflow for long histories.
- Completed is the third desktop board column and the first populated status in
  the current mobile board. Board/table cards use raffle counts instead of
  repeating Partner/Raffle partner text when no meaningful chain/category is
  set.
- Added reusable partner-mark and raffle-banner media. Partner marks fall back
  to project initials. Attached raffle banners render in a full 16:9 frame with
  `object-contain`; failed/expired sources render a branded archive fallback
  rather than a broken image.
- Dashboard Vitest passes 42 tests across 15 files. Dashboard TypeScript,
  Prisma schema validation, the production Next.js build with
  `NODE_ENV=production`, and `git diff --check` pass.
- Application commits `110300a` and `3fa9204` are pushed to `origin/main`.
  Both connected Vercel deployments completed successfully for `3fa9204`.
  Production database verification found zero host mismatches across 34
  imported records: BigOhms hosts 22, H A S H R Y hosts 9, and Outis hosts 3.
  Signed-in QA confirmed the Spreadsheet header says Hosted by, row-level host
  names vary by raffle creator, and KUONnft now shows `Hosted by · BigOhms` in
  both its header and overview. The earlier presentation QA also verified
  `Completed 29 · all time`, Completed in the first three board columns, zero
  horizontal overflow at a 772 px viewport, the expired KUONnft media fallback,
  and two valid 1500x500 Mochimons banners rendered with
  `object-fit: contain`.

### Complete KOS raffle archive import — production verified

- The earlier bootstrap deliberately left nine records unlinked: five ended
  raffles with zero entries, two ended test-era raffles, and two cancelled
  NUTSY repost attempts. On 2026-07-13, the owner explicitly requested the
  complete archive, so all nine were imported or attached.
- Production now has zero unlinked retained raffle records across `ENDED` and
  `CANCELLED`: 59 linked out of 59. The six newly represented partner records
  are neonbaby, neonflash, vermie, PILLAS, Test test, and testy. The early KUON
  raffle was merged into KUONnft, while both NUTSY cancellations were attached
  to the existing NUTSY record.
- Empty and cancelled records do not increase `whitelistAllocation`. The two
  ended test-era raffles retain their one delivered spot and winner workflow
  row each. The import wrote tenant-scoped collaboration activities and the
  `COLLABORATION_FULL_HISTORY_IMPORT` organization audit event.
- The historical import verification confirmed 38 collaboration records, 35
  completed records, three active records, and 458 collected WL spots at that
  time. NUTSY showed four attached raffles with allocation still seven, and
  KUONnft showed two attached raffles with allocation still three. A later
  signed-in browser check showed 32 unarchived grouped relationships in the
  current Hub view while the source archive still contained all 59 raffles.
- The Collab Hub `Active · 3` metric is collaboration pipeline state, not the
  reusable task count. At verification time the active records were the manual
  `test` lead, submitted JEETErS, and submitted KUONnft. Production currently
  has zero active reusable `TaskDefinition` rows. Team task management remains
  at `/:org/tasks`; members complete standalone point tasks at `/me/points` and
  raffle-specific tasks at `/me/raffles`.

### Collab project-banner presentation — production verified

- Collab Hub list responses now include each attached raffle's `bannerUrl` and
  `endAt`. Board cards render the project's linked raffle banner as full-width
  media, while spreadsheet/mobile rows use a compact horizontal banner
  thumbnail instead of treating the banner as a square partner logo.
- Banner selection prefers the newest ended raffle over cancelled attempts and
  retries older attached banner sources automatically when the preferred URL
  fails. When every historical Discord attachment has expired, the existing
  project-branded archive fallback remains in place.
- Partner directory marks still use `CollaborationPartner.logoUrl`; raffle
  banners remain raffle media and are not copied into partner branding.
- Focused presentation tests, dashboard TypeScript, the production dashboard
  build, and `git diff --check` pass. The change is included in production
  commit `61d605b`.

### Automatic hosted-raffle connection — production verified

- A successful Discord post now calls the bot-side Collab Hub linker after the
  raffle `messageId` is stored. This covers Discord-created raffles, dashboard
  DRAFT publication, scheduled raffles, and successful reposts through the same
  `publishRaffleMessage` boundary.
- The linker resolves the organization from the raffle's unique guild
  connection, matches partner identity by normalized project name/project X
  URL, reuses a non-terminal campaign, or creates a new Scheduled/Hosting
  collaboration. Terminal completed/submitted/cancelled relationships are not
  reopened for a later campaign.
- The once-per-minute bot automation sweep retries up to 50 published
  UPCOMING/LIVE/ENDED raffles that remain unlinked, so a transient database
  error after Discord publication is self-healing. Draw-time reconciliation
  also ensures the link before syncing winners and wallets.
- Collab Hub now reports the all-time connected-raffle count independently of
  grouped collaboration cards and provides a `View all N raffles` link to the
  organization raffle archive. A fresh production browser check counted all 59
  rows in `/:org/raffles` while the Hub reported 32 visible grouped
  collaboration relationships. Repeated GTD/FCFS rounds—and any relationship
  records outside the current unarchived workspace—explain why those totals are
  intentionally different.
- Bot tests cover collaboration project normalization, GTD/FCFS tagging, safe
  X-profile extraction, and protected auto-cleanup classification. Production
  smoke raffle #63 proved the Discord publish boundary creates the Hub link;
  dashboard deletion then removed the raffle, auto-created collaboration, and
  unused partner without touching manual CRM records.

### Collab debt closure and RH wallets — production verified

- New Discord attachment banners are now persisted before publication in the
  one-to-one `RaffleBannerAsset` table. The bot accepts only Discord attachment
  hosts and supported image types, enforces a 5 MB streamed limit, and rewrites
  `Raffle.bannerUrl` to the versioned public `/r/:id/banner` endpoint before
  Discord receives the post. Dashboard Vercel Blob uploads are unchanged.
- Migration `20260713230000_raffle_banner_assets` was applied successfully to
  production Neon on 2026-07-13. It is additive and cascades asset deletion
  with its source raffle.
- History import now opens a tenant-scoped preview showing unlinked, standard,
  selected, and grouped totals. Empty ended raffles, cancelled attempts, and
  test-named records are explicit opt-ins; exceptional attempts contribute no
  allocation unless they are ended records with entries.
- The Active summary card is now keyboard-accessible and toggles the complete
  active-status filter. The status selector exposes the same Active pipeline
  option.
- The Robinhood Chain migration
  `20260713234500_robinhood_wallet_chain` is applied. Teams can select
  `Robinhood Chain (RH)` on web or Discord raffle creation/editing; members can
  register the exact chain on web or with `/wallet`, and EVM format validation
  is shared by both runtimes.
- All 10 bot tests and all 47 dashboard tests pass. DB/bot/dashboard
  typechecks, Prisma validation, DB/bot builds, the dashboard production
  build, and `git diff --check` pass.
- Commits `61d605b`, `9ae01fb`, `d52e25c`, and `85b82e8` are pushed to
  `origin/main`. Both additive migrations are applied, the EC2 bot is online
  with the compiled cleanup/RH code, and production dashboard QA shows RH in
  both the team raffle builder and member wallet editor.
- Controlled no-ping smoke raffle #63 stored `ROBINHOOD`, published to Discord,
  and appeared as `KOS System QA` while the Hub moved from 59 to 60 connected
  raffles. Dashboard deletion returned the Hub to 59 and production database
  verification found no raffle, collaboration, or unused partner residue.
- A production-log audit found repeated entry clicks were correctly handled as
  duplicates but still caused noisy Prisma P2002 messages. Commit `d922ac0`
  replaces exception-driven inserts with transactional conflict skipping on
  both Discord and web. Only the winning insert increments `entryCount`; every
  raced repeat keeps the existing “already entered” response.

Current assumptions:

- “All raffle history” means every retained ended/cancelled raffle row. Deleted
  raffle records cannot be reconstructed from the current database.
- Cancelled repost attempts belong to the successful partner relationship for
  audit visibility but are not additional allocations or completed campaigns.
- “Hosted” begins only after Discord accepts the raffle post. A DRAFT row or a
  failed publish does not represent a real hosted collaboration.
- Multiple concurrently active raffles for the same normalized partner belong
  to one campaign; a raffle published after that relationship becomes terminal
  starts a new campaign for the same durable partner.
- `Raffle.createdById` identifies the team admin who hosted an imported raffle.
- Current production groups have one host each; the majority/recent tiebreaker
  is retained for future mixed-host history.
- A raffle banner remains attached-raffle media and is not inferred to be a
  partner logo.
- Robinhood Chain is treated as an EVM network for address formatting only;
  KOS does not perform signature or on-chain ownership verification.

Current technical debt:

- No actionable release debt remains from this hardening slice. The 40
  already-expired Discord interaction banners are an irrecoverable historical
  data limitation; their branded fallback is permanent and new uploads are
  durable.
- Historical partner grouping is still heuristic. The existing deterministic
  rules and tenant boundaries are tested, but a manual partner merge/split
  review surface would make exceptional identity changes self-service.

Recommended next task:

- Add a tenant-scoped partner merge/split review workflow with a dry-run impact
  preview, source-raffle reassignment, audit entries, and undo-safe validation.

- Git worktree was clean before documentation changes.
- Prisma schema validates with Prisma 5.22.0.
- `pnpm typecheck` passes for DB, dashboard, and bot.
- `@kos/db`, `@kos/bot`, and `@kos/dashboard` build successfully when invoked
  individually.
- Next.js production build compiles all pages and API routes successfully.
- The first S2.5 hardening slice passes the dashboard TypeScript check and a
  fresh Next.js production build.
- The profile Tasks hub and org raffle detail UI hardening also pass dashboard
  TypeScript and a fresh Next.js production build.
- The legacy social-task rendering and responsive banner/card follow-up passes
  dashboard TypeScript and a fresh Next.js production build.
- The legacy social-task click/verify gate passes dashboard and bot TypeScript
  checks plus dashboard and bot production builds.
- The member task-card visual cleanup passes dashboard TypeScript and a fresh
  Next.js production build.
- The first product-wide UI refresh slice passes dashboard TypeScript and a
  fresh Next.js production build.
- The second product-wide UI refresh slice passes dashboard TypeScript,
  `git diff --check`, and a fresh Next.js production build.
- The points + weighted-role raffle slice passes dashboard/bot TypeScript,
  `git diff --check`, `@kos/db` build, `@kos/bot` build, and a fresh
  `@kos/dashboard` production build.
- The profile/full-width layout follow-up passes dashboard TypeScript and a
  fresh `@kos/dashboard` production build.
- Production migration `20260707170000_points_role_weights` has been applied
  to Neon via `pnpm --filter @kos/db migrate:deploy`.
- Commit `e0bd4c8` has been pushed to `origin/main`.
- EC2 bot deploy was run with `./scripts/deploy-ec2.sh`; it synced code,
  rebuilt `@kos/db` and `@kos/bot`, re-registered Discord slash commands,
  restarted PM2 process `kos-bot`, and returned
  `{"ok":true,"ready":true}` from `http://127.0.0.1:4000/internal/health`.
- Vercel production domain `https://kos-wl-bot-dashboard-3a8x.vercel.app`
  responds. `/me` redirects unauthenticated users to `/login?next=%2Fme`,
  `/me/points` redirects to `/login?next=%2Fme%2Fpoints`, and the new
  `/api/me/points` and `/api/kos/points` endpoints return `401` instead of
  `404`, confirming the points routes are live on the web deployment.
- Focused dashboard policy and tenant-isolation tests are available through
  `pnpm --filter @kos/dashboard test`; broader coverage remains incomplete.

## Handoff reconciliation

Claude's final message matches the shipped commits and most behavior. Important
precision points:

1. Community pages under `/c/:slug` do not require organization membership,
   but middleware still requires a signed session. They are not anonymous.
2. The new-raffle and edit modals can both select verification tasks. The
   raffle detail API now returns attached task-gate metadata.
3. X and visit-link tasks are attestations. They prove linked identity/click
   intent, not the underlying follow/like/repost/comment/visit action.
4. Rerolls are deterministic for their generated seed, but that seed is not
   persisted and the refreshed proof still exposes the original raffle draw
   commitment. Reroll reproducibility is therefore incomplete.
5. Billing is hidden from navigation only; `/:org/billing` remains reachable.
6. `/me/tasks` is no longer only a deep-link target. It now lists live raffles
   from public KOS communities, shows attached verification tasks and legacy
   raffle social/link tasks inline, and embeds the same web entry panel used by
   public raffle pages. Legacy social/link tasks are click-and-attest steps:
   users must open the link, then verify the step before entry.

## Known technical debt and risks

### High priority

- Automated tests now cover public raffle policy, duplication/tenant isolation,
  community discovery, X normalization, OAuth refresh/rate-limit resilience,
  and authenticated desktop/mobile Communities + Branding visuals. Draw logic,
  full eligibility parity, wallet validation, scheduler requests, and broader
  Discord member workflows still lack automated browser coverage.
- Documentation outside the new takeover docs is substantially pre-Phase 3.
  `README.md`, `GUIDE.md`, `docs/VERCEL.md`, deployment/security guides, and
  `.env.example` still emphasize the localhost control API and omit several
  Phase 2/3 environment variables.
- Dashboard image upload requires only base org membership, not
  `branding:edit` or another mutation permission.

### Correctness / product gaps

- `minMessages` is only a non-blocking bot flag and is ignored on web.
- Discord reaction lookup fetches at most 100 reaction users, so valid reactors
  beyond that page can be rejected.
- Bot inline Discord-task verification does not write an organization
  `AuditLog`; verification attempts generally are not audited as required by
  the Phase 3 specification.
- Notifications for rerolls notify new winners but do not notify replaced
  winners, and losers are intentionally omitted from the reroll call.
- Winner CSV export on the per-raffle dashboard route uses only
  raffle-specific `Wallet`; XLSX and org-wide wallet exports correctly fall
  back to `WalletProfile`.
- Public raffle pages show legacy honor-system social tasks but do not render
  Task Engine definitions until the signed-in entry checklist/API is loaded.

### Operational

- Proof artifacts retain an EC2-local cleanup copy and Discord delivery, but
  every production proof now also has a portable encrypted database copy for
  tenant-authorized dashboard downloads.
- Raffle deletion removes the live raffle post and EC2 proof files, but cannot
  remove the previously delivered proof-channel message because its Discord
  message ID is not stored.
- Legacy internal control API code/config remains even though production uses
  DB mediation.
- The scheduler is designed for one bot instance; multiple bot instances could
  race on state transitions and queued requests.
- Dependency versions are intentionally old enough to have major upgrades
  available (Prisma 5, Next 14); do not upgrade incidentally.

## Recommended next task

Add a lightweight historical-partner review and merge/split workflow, then run
the controlled Phase 4 operational acceptance pass:

1. review the 34 imported partners, merge genuine brand/name aliases, split any
   false social match, and preserve all unique source-raffle links;
2. create a collaboration, assign a teammate, add a sanitized note and private
   attachment, attach/create a raffle, and exercise the reminder workflow;
3. complete the raffle, reconcile a registered member wallet, export the
   submission file, and download all three portable proof artifacts;
4. convert the acceptance path into authenticated browser/API tests covering
   tenant isolation, private file authorization, wallet conflicts, and status
   automation;
5. after acceptance, start the full Campaigns layer while keeping points,
   rewards, raffles, and Discord/web participation on the shared ledgers.

## Member activity and private proof hardening — committed/deployed

- Participant identities are clickable from the organization Participants
  table, live raffle participant table, points leaderboard/recent activity,
  and winner-wallet table.
- `/:org/participants/:userId` consolidates tenant-scoped raffle entries,
  active/replaced wins, points balance and events, task verification, reward
  claims, entry weights, Discord identity snapshots, and permitted wallet-chain
  registration status.
- The member route requires `participant:view`, proves that the user has
  activity owned by the current organization, scopes guild-backed records by
  connected guild IDs, scopes native records by `organizationId`, and requires
  `wallet:view` before showing even wallet registration status. It never shows
  wallet addresses.
- Totals use database aggregates; activity lists are bounded to recent rows so
  heavily active members do not create unbounded dashboard responses.
- Discord winner announcements now use
  `Community × Project — WL Raffle Finished`, with the linked organization name
  and the Discord guild name as a fallback.
- Community branding now carries into generated proof cards/reports by using
  the organization name/logo when available.
- When `hideEntries` is enabled, the winner announcement, proof Discord embed,
  PNG card, and PDF report omit entry totals entirely. No `Private` label or
  placeholder is rendered. The winners-only CSV never contained entry totals.
- Added bot presentation tests for community/project winner titles and private
  completion output.

Verification:

- `pnpm --filter @kos/dashboard typecheck`
- `pnpm --filter @kos/bot typecheck`
- `pnpm --filter @kos/dashboard test` — 7 files, 19 tests passed.
- `pnpm --filter @kos/bot test` — 2 tests passed.
- `pnpm --filter @kos/bot build`
- `pnpm --filter @kos/dashboard build`
- `git diff --check`

No schema migration or environment change is required. The working tree has
been committed and pushed as part of `6f252d7`.

## Ended member raffles and team deletion — committed/deployed

- `/api/me/tasks` retains `raffles` for up to 50 live raffles and adds a
  separate `endedRaffles` collection for the 30 most recently ended raffles.
  Historical cards include inactive attached task definitions so members can
  still understand the requirements that applied when the raffle ran.
- `/me/raffles` now has separate **Enter raffles** and **Ended raffles**
  sections. Ended cards retain banners, community/project details, visibility-
  safe entry totals, a compact task-completion summary, and results links while
  replacing entry with an explicit `Raffle ended` panel. Full historical task
  rows load only after **Review tasks**, avoiding an oversized 30-card page.
- Focused ended raffle views render the same historical tasks in read-only mode
  and disable task verification/open actions. `EntryPanel` also uses the exact
  `Raffle ended` state for ENDED records.
- Team action menus expose **Delete raffle** only to owners/roles with
  `raffle:delete`, across the overview, raffle list, and raffle detail page.
  The confirmation explains cascading removal and is keyboard dismissible.
- Dashboard deletion is tenant-scoped and idempotent. It immediately changes
  the raffle to CANCELLED and writes `RAFFLE_DELETE_REQUEST`; no Discord or EC2
  filesystem side effect runs from Vercel.
- The bot scheduler consumes deletion requests before publish/edit/draw work,
  removes the shared Discord raffle post, removes stored PDF/CSV/PNG proof
  files, records the deletion audit, and deletes the raffle row. Existing
  Discord `/raffle delete` now receives the same proof cleanup and audit-order
  correction.
- Added route tests for tenant isolation, atomic cancellation/queueing, audit
  logging, and idempotent repeat requests.

Verification and deployment:

- `pnpm typecheck` passes for DB, dashboard, and bot.
- `pnpm test` passes: dashboard 22 tests across eight files; bot two tests.
- `pnpm build` passes for DB, dashboard, and bot.
- Application commit `6f252d7` (`Add member insights and raffle lifecycle
controls`) and compact ended-history follow-up `eef3257` were pushed to
  `origin/main`.
- EC2 deploy rebuilt DB/bot, registered seven guild commands, restarted PM2
  process `kos-bot`, reported `online`, and returned
  `{"ok":true,"ready":true}` from the internal health endpoint.
- Both Vercel projects reported successful/Ready production deployments for
  `eef3257`. Deployment `dpl_CCYkxNL7JGAs5yuZsquSEvGRhFbi` was verified as
  commit `eef3257` and explicitly assigned to `https://raffle.koslabs.app`.
- Authenticated production QA confirmed `/me/raffles` exposes separate live
  and ended sections with 30 recent ended raffles and read-only ended states.
  It also confirmed all 59 team raffle rows expose Actions and that an expanded
  menu includes **Delete raffle**. No raffle was deleted during QA.
- No schema migration or environment-variable change is required.

## Changes in this takeover task

Documentation only:

- `docs/AGENTS.md` — created.
- `docs/HANDOFF.md` — created.
- `docs/ARCHITECTURE.md` — replaced stale single-tenant architecture with the
  current Phase 3 topology and flows.
- `docs/DECISIONS.md` — created to capture accepted product and architecture
  decisions.
- `docs/PROJECT_RULES.md` — created.

No application logic, schema, migration, environment variable, secret,
deployment, or production state was changed in that initial takeover
checkpoint. The documentation was committed as `e0acedf` before hardening
began.

## S2.5 hardening progress

### Raffle task-gate editing and atomic updates — complete locally

- Raffle detail data now includes current active `RaffleTask` links and the
  organization's available active task definitions.
- The edit modal renders the verified-task checklist and sends
  `verificationTaskIds` with saves.
- The raffle detail API includes attached task metadata.
- Raffle scalar changes, eligible-role replacement, and task-gate replacement
  now run in one Prisma transaction.
- Duplicate role/task IDs are normalized before insertion.
- Updating legacy social tasks merges them into the existing requirements JSON
  instead of erasing account-age, server-age, reaction, or extra-role gates.

Verification at that point: dashboard typecheck and production build passed;
no database, Discord, or browser integration smoke test was run for that
specific slice. A focused dashboard test harness was added later.

### Profile task hub and org raffle detail cleanup — committed/pushed

- `/api/me/tasks` now supports two modes:
  - no `raffle` query param: returns up to 50 live raffles from non-suspended
    public KOS communities, plus the signed-in user's attached task completion
    states and the raffle's legacy social/link tasks from `requirements.tasks`;
  - `?raffle=N`: preserves the existing one-raffle task detail response.
- `/me/tasks` now shows active raffle cards with inline Task Engine verification
  tasks, legacy Follow/Like/Retweet/etc. social steps, X-link prompting, task
  verification buttons, a focus view link, and the existing `EntryPanel` so
  members can complete tasks and enter from the Tasks tab.
- `/me/tasks?raffle=N` now keeps the focused task list but also embeds the web
  entry panel and no longer tells users to enter in Discord after completing
  tasks.
- Legacy social/link tasks render as "Open step" actions, not fake verified
  checks, because they are honor-system links rather than X API checks.
- Legacy social/link tasks now persist click and verify attestations as guild
  `Log` rows (`SOCIAL_TASK_CLICK` and `SOCIAL_TASK_VERIFY`) with a stable
  `taskKey` in metadata. This avoided a production database migration but means
  these attestations are state stored in the audit log table.
- Web entry gates and Discord bot entry gates both require those legacy
  social/link tasks to be verified. The bot reuses its existing
  `tasks_incomplete` response and points users to `/me/tasks?raffle=N`.
- Active raffle cards now use a compact natural-aspect banner strip, not a
  large side column or forced 16:9/vertical frame. The task rows are now a
  cleaner one-CTA checklist (`Open task` -> `Verify` -> `Verified`), and the
  embedded entry panel uses a compact style inside the profile Tasks hub.
- The org raffle detail page now renders an `Entry Requirements` card for
  wallet, account-age, server-age, reaction, Task Engine, and legacy social
  requirements instead of dumping `requirements` JSON.
- The org raffle detail winners empty state is now a designed "Winners pending"
  card instead of plain text.

Verification: `pnpm --filter @kos/dashboard typecheck`,
`pnpm --filter @kos/bot typecheck`, `pnpm --filter @kos/dashboard build`, and
`pnpm --filter @kos/bot build` pass with a placeholder `DATABASE_URL` for the
dashboard build. The latest UI cleanup was verified with
`pnpm --filter @kos/dashboard typecheck` and
`pnpm --filter @kos/dashboard build`. Changes were pushed to GitHub `main` for
Vercel deployment. No authenticated browser smoke test or live Discord gate
check was run.

### Product UI refresh slice 1 — committed/pushed

- Dark-mode design tokens now follow the premium KOS palette more closely:
  `#0A0A0A` background, `#111111` panels, `#181818` cards, subtle borders,
  electric-blue primary accents, purple secondary accents, stronger focus
  states, and more polished card/button depth.
- Shared primitives were refreshed: stat cards, page titles, segmented tabs,
  cards, empty states, inputs, badges, and primary buttons now establish the
  new SaaS baseline across existing pages.
- Org manager shell now has a collapsible desktop sidebar, premium command
  center header, stronger current-page state, command/search bar treatment, and
  visible disabled Points/Rewards IA placeholders.
- Member `/me` shell now shares the new dark premium header, gradient KOS mark,
  segmented navigation, and wider content frame.
- The org dashboard overview was refreshed with clearer hierarchy, improved
  stats, chart framing, live refresh affordance, and sharper quick actions.
- Login was redesigned as a premium split hero/auth panel instead of a simple
  centered card.

Verification: `pnpm --filter @kos/dashboard typecheck` and
`pnpm --filter @kos/dashboard build` pass with a placeholder `DATABASE_URL`.
No authenticated visual/browser QA was run.

### Product UI refresh slice 2 — committed/pushed/deployed

- Shared design system was expanded with premium SaaS surfaces:
  - stronger Inter/Geist/SF-style font stack;
  - larger rounded cards/buttons/inputs;
  - reusable `TableShell` with sticky headers, horizontal scrolling, and
    consistent row hover treatment;
  - improved empty states, page title hero treatment, metrics, labels, and
    focus styling.
- Data-heavy org/admin pages now use the shared table treatment:
  `/[org]/raffles`, `/[org]/participants`, `/[org]/wallets`,
  `/[org]/analytics` host table, `/admin`, `/admin/users`,
  `/admin/subscriptions`, and the live participant table on raffle detail.
- Public community and raffle pages were redesigned around premium cards,
  better hierarchy, and mobile-friendly spacing.
- Banner rendering no longer forces a wide horizontal crop on public community
  pages, public raffle pages, or profile task cards. Banners now render as
  natural-aspect contained media with max-height limits and polished backdrop
  treatment, so vertical/square/wide project art can all fit.
- Public raffle steps now render as clean numbered cards instead of a plain
  list.
- `/me/tasks` raffle cards were tightened further: cleaner card shell,
  refined task rows, clearer status/points badges, larger CTA column, and the
  compact entry panel/gate checklist now uses premium nested cards.
- Member profile, communities, history, and wallet pages were pulled into the
  same visual language with stronger stats/actions, richer community cards,
  cleaner history cards, and a more polished wallet editor.
- The web entry panel checklist now lays out gates as cards on desktop/mobile
  instead of a dense plain list.
- New/edit raffle modals were widened and restyled as premium modal windows
  with clear section hierarchy, mobile padding, and stronger close/action
  treatment while preserving existing behavior.

Verification:

- `pnpm --filter @kos/dashboard typecheck`
- `git diff --check`
- `DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder pnpm --filter @kos/dashboard build`

No authenticated browser visual QA was run.

### Points and weighted role raffles — committed/pushed/deployed, migration applied

- Migration `20260707170000_points_role_weights` adds:
  - `Raffle.useRoleWeights`;
  - `Participant.weight`;
  - `RoleWeight`;
  - `PointsLedger`.
- Production Neon migration was applied successfully with
  `pnpm --filter @kos/db migrate:deploy`.
- Task Engine completions now award points exactly once per
  `(organizationId, userId, taskId)` through the append-only
  `PointsLedger`.
- Points award paths are wired through:
  - web task verification;
  - manual review approvals;
  - bot inline Discord join/role verification.
- Members can view balances at `/me/points`; org managers can view a
  leaderboard and recent point awards at `/:org/points`.
- Org managers can configure role multipliers under
  `/:org/settings` → Weighted raffle roles. The UI uses sliders; the API
  stores multipliers above `1×` and treats missing rows as default `1×`.
- New/edit raffle modals can enable `useRoleWeights`. Public and admin raffle
  views surface when a draw is weighted.
- Web and Discord entry both snapshot the participant's draw weight at entry
  time. The value is the maximum configured multiplier among the member's held
  roles; missing/unconfigured roles default to `1×`.
- Final draws and rerolls use deterministic weighted sampling when
  `useRoleWeights` is enabled and the existing uniform sampler otherwise.
  Weighted draw audit metadata records that the draw was weighted and the total
  eligible weight.
- The org dashboard header now includes a persistent `/me` profile button and
  avatar link, so users are no longer forced to find the profile link at the
  bottom of the sidebar.

Verification:

- `pnpm --filter @kos/dashboard typecheck`
- `pnpm --filter @kos/bot typecheck`
- `git diff --check`
- `pnpm --filter @kos/db build`
- `pnpm --filter @kos/bot build`
- `DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder pnpm --filter @kos/dashboard build`

Operational note: sourcing the entire root `.env` before `next build` sets a
non-standard `NODE_ENV` and can cause Next/React prerender failures. Use the
dashboard's normal Vercel environment or set only the needed variables for
local build verification.

Deployment verification:

- Code committed as `e0bd4c8` (`Ship points, weighted raffles, and UI refresh`)
  and pushed to `origin/main`.
- Production Neon migration `20260707170000_points_role_weights` applied.
- EC2 bot deployed via `./scripts/deploy-ec2.sh`; PM2 reported `kos-bot`
  online and the local internal health endpoint returned
  `{"ok":true,"ready":true}`.
- Vercel production route canaries for the new points slice returned expected
  auth responses rather than not-found responses:
  `/api/me/points` → `401`, `/api/kos/points` → `401`,
  `/me/points` → `307 /login?next=%2Fme%2Fpoints`.

### Profile layout and footer follow-up — committed/pushed/deployed

- Removed decorative bottom footers from the member shell and org dashboard
  shell so `Powered by KOS` no longer appears as a stuck bottom bar while
  navigating app pages.
- Removed the bottom footer-style branding line from public community pages.
- Expanded the member `/me/*` shell from a centered `max-w-6xl` frame to a
  full-width content area with responsive page padding, giving profile, tasks,
  points, wallet, history, and communities pages more room on desktop.
- The member header now uses full-width spacing, keeps the KOS mark fixed, and
  lets the tab nav scroll cleanly when horizontal space is tight.

Verification:

- `corepack pnpm --filter @kos/dashboard typecheck`
- `DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder corepack pnpm --filter @kos/dashboard build`
- Code committed as `eea9273` (`Fix profile layout footer spacing`) and
  pushed to `origin/main`.
- Vercel production build changed from `7_xpqp9WPfMPaNH-RVtNU` to
  `M9DVZBMCojLuMapfxppx1`, confirming the web deployment rolled over.

Operational note: invoking the Codex-bundled `pnpm` currently resolves to
pnpm 11, while this repository is pinned to `pnpm@9.12.0`. Use
`corepack pnpm ...` for local verification to avoid pnpm 11's unrelated
build-approval prompts and workspace-file scaffolding.

### Typography follow-up — committed/pushed/deployed

- The dashboard initially moved from device/system fallback fonts to tracked
  Inter font assets.
- Global typography now routes through `--font-kos-sans` and enables Inter's
  readability alternates for cleaner UI text rendering.

Verification:

- `corepack pnpm --filter @kos/dashboard typecheck`
- `git diff --check`
- `DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder corepack pnpm --filter @kos/dashboard build`
- Code committed as `c5c5a08` (`Load proper dashboard font`) and pushed to
  `origin/main`.
- Vercel production build changed to `vyHDOsTNlFBJAuqCOBxyJ`; the served CSS
  contains both `--font-kos-sans` and `@font-face`, confirming the self-hosted
  Inter font is active in production.

### Points channel, rewards, and Discord parity slice — committed/pushed/deployed

- Migration `20260707230000_rewards_points_channel` adds:
  - `Guild.defaultPointsChannelId`;
  - `Reward`;
  - `RewardRedemption`;
  - `RewardRedemptionStatus`.
- Typography was upgraded again from two static local Inter weights to the
  full Inter variable family through `next/font/google`, so medium/semibold
  and heading weights are no longer browser-synthesized.
- Org managers can configure a points channel from `/:org/points`; Discord
  admins can also set it with `/config channels points:#channel`.
- Task point awards and reward redemptions post best-effort updates to the
  configured points channel.
- Org managers can create/pause rewards and fulfill/refund pending claims at
  `/:org/rewards`.
- Members can browse and redeem rewards at `/me/rewards`; `/me/points` now
  links directly to both earning tasks and spending rewards.
- Discord parity added:
  - `/points balance`, `/points leaderboard`, `/points panel`;
  - `/tasks list`, `/tasks verify`;
  - `/rewards list`, `/rewards redeem`, `/rewards mine`;
  - manager-only `/rewards create`, `/rewards fulfill`, `/rewards cancel`.
- Reward redemptions spend points through the append-only `PointsLedger` with
  negative `REWARD_REDEEM` rows. Cancelled/rejected pending claims refund via
  positive `REWARD_REFUND` rows and restore stock when the reward has limited
  inventory.
- Limited-stock redemptions claim stock with an atomic conditional decrement on
  both web and Discord paths to avoid overselling during concurrent clicks.

Verification:

- `corepack pnpm --filter @kos/db build`
- `corepack pnpm --filter @kos/bot typecheck`
- `corepack pnpm --filter @kos/dashboard typecheck`
- `corepack pnpm --filter @kos/bot build`
- `DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder corepack pnpm --filter @kos/dashboard build`
- `git diff --check`
- Code committed as `b4485ea` (`Launch points rewards and Discord parity`) and
  pushed to `origin/main`; the follow-up atomic stock-claim fix was committed
  as `6a6a5d2` (`Make reward stock claims atomic`) and pushed to `origin/main`.
- Production Neon migration `20260707230000_rewards_points_channel` applied
  successfully via `corepack pnpm --filter @kos/db migrate:deploy`.
- A fresh production migration check after `6a6a5d2` reported 18 migrations
  and "No pending migrations to apply."
- EC2 bot deployed again via `./scripts/deploy-ec2.sh` after `6a6a5d2`;
  Discord slash command count remained 7, PM2 reported `kos-bot` online, and
  the local internal health endpoint returned `{"ok":true,"ready":true}`.
- Vercel production serves the rewards routes: `/api/me/rewards` returns `401`
  and `/me/rewards` redirects to `/login?next=%2Fme%2Frewards`. The Vercel
  project is assumed to auto-deploy `main`; this shell has no Vercel CLI/API
  credential to inspect the deployment record directly.

### Standalone member tasks clarity — committed/pushed/deployed

- `/api/me/tasks` now returns two explicit member lanes:
  - `taskGroups`: active standalone Task Engine tasks grouped by community,
    with each member's completion/click state and current org point balance;
  - `raffles`: live raffle task workspaces for the Raffles tab/focused
    compatibility flows.
- `/me/points` now leads with "Standalone earning tasks" so members can
  complete org-created tasks and earn points even when those tasks are not
  attached to a raffle.
- Raffle task workspaces belong in `/me/raffles?raffle=N` (and the hidden
  `/me/tasks` compatibility route), preserving web raffle entry behavior
  without mixing raffle gates into the Points tab.
- Web X/link/visit tasks now use the same Open → Verify flow as legacy raffle
  social steps: members must open the task link before the server accepts
  verification. Already-verified tasks remain backward-compatible.
- Org task-builder copy now explains that active tasks appear immediately in
  the member points/tasks workspace, and should be attached to raffles only
  when they also gate entry.
- `/me/points` is the member earning surface for standalone point tasks.
- Discord already exposes standalone org tasks through `/tasks list` and
  `/tasks verify`; `/points panel` copy now says that explicitly.

Verification:

- `corepack pnpm --filter @kos/dashboard typecheck`
- `corepack pnpm --filter @kos/bot typecheck`
- `git diff --check`
- `DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder corepack pnpm --filter @kos/dashboard build`
- `corepack pnpm --filter @kos/bot build`
- Code committed as `a8f44b9` (`Clarify standalone member tasks`) and pushed
  to `origin/main`.
- EC2 bot deployed via `./scripts/deploy-ec2.sh`; Discord slash command count
  remained 7, PM2 reported `kos-bot` online, and the local internal health
  endpoint returned `{"ok":true,"ready":true}`.
- Vercel production route canaries for the member task surface returned
  expected auth responses: `/api/me/tasks` → `401`, `/me/tasks` →
  `307 /login?next=%2Fme%2Ftasks`.

No database migration is required; the implementation reuses
`TaskDefinition`, `TaskCompletion`, `PointsLedger`, and `Log` for click state.

### Discord raffle task verification parity — committed/pushed/deployed

- Discord raffle entry no longer pushes members to the website when raffle
  social/link tasks are incomplete.
- Live raffle posts now render a Verify button row for legacy
  `requirements.tasks` steps, alongside the existing task link buttons.
- If a member clicks Enter before tasks are complete, the ephemeral Discord
  response lists the missing tasks and includes Discord-native buttons:
  task link buttons where a URL exists plus Verify buttons for each missing
  step.
- Pressing Verify for a legacy raffle task writes the same
  `SOCIAL_TASK_VERIFY` audit/log state used by the web gate, then immediately
  re-attempts entry. If all gates pass, the member is entered automatically.
- Pressing Verify for a Task Engine raffle task runs the existing bot-side task
  verifier, awards points when applicable, then immediately re-attempts entry.
- No database migration is required; the implementation reuses the existing
  raffle requirements JSON, `TaskCompletion`, `PointsLedger`, and `Log`.

Verification:

- `corepack pnpm --filter @kos/bot typecheck`
- `corepack pnpm --filter @kos/bot build`
- `corepack pnpm --filter @kos/dashboard typecheck`
- `DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder corepack pnpm --filter @kos/dashboard build`
- `git diff --check`
- Code committed as `3a51112` (`Restore Discord raffle task entry`) and pushed
  to `origin/main`.
- EC2 bot deployed via `./scripts/deploy-ec2.sh`; Discord slash command count
  remained 7, PM2 reported `kos-bot` online, and the local internal health
  endpoint returned `{"ok":true,"ready":true}`.

### Member profile IA cleanup — committed/pushed/deployed

- Member navigation now exposes a dedicated `/me/raffles` panel and removes the
  visible Tasks tab.
- `/me/raffles` is intentionally entry-focused: live raffle cards, stats,
  `EntryPanel` controls, and focused `/me/raffles?raffle=N` task/entry flows
  when a raffle gate needs task verification.
- `/me/points` owns earning: it keeps balances/recent activity and embeds the
  reusable standalone task workspace below the points summary.
- `/me/tasks` remains available as a hidden compatibility route for old links,
  but new UI links and gate "Fix it" links point to `/me/points` for earning
  tasks or `/me/raffles?raffle=N` for raffle-specific gates.
- Auth middleware now preserves the full path and query in `next`, so
  unauthenticated focus links such as `/me/raffles?raffle=N` return to the
  same focused view after login.
- Profile and Rewards CTAs now route users to `/me/raffles` for entry and
  `/me/points` for earning.
- Org task-builder and raffle-builder copy now says member tasks appear in the
  Points panel, not a Tasks tab.
- Discord `/tasks verify` fallback link and `/points panel` copy now point to
  the web Points panel.

Verification:

- `corepack pnpm --filter @kos/dashboard typecheck`
- `corepack pnpm --filter @kos/bot typecheck`
- `git diff --check`
- `DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder corepack pnpm --filter @kos/dashboard build`
- `corepack pnpm --filter @kos/bot build`
- Code committed as `aea02b2` (`Split member raffles and points panels`) and
  pushed to `origin/main`.
- EC2 bot deployed via `./scripts/deploy-ec2.sh`; Discord slash command count
  remained 7, PM2 reported `kos-bot` online, and the local internal health
  endpoint returned `{"ok":true,"ready":true}`.
- Vercel production route canaries for the new member IA returned expected auth
  redirects instead of not-found responses: `/me/raffles` →
  `307 /login?next=%2Fme%2Fraffles` and `/me/points?raffle=1` → `307`.
- Follow-up middleware fix verified with
  `corepack pnpm --filter @kos/dashboard typecheck`,
  `DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder corepack pnpm --filter @kos/dashboard build`,
  and `git diff --check`.

No database migration is required; this is a dashboard/bot-copy IA cleanup.

### Dashboard search, mobile member sidebar, raffle/points IA correction, and Discord entry feedback — committed/pushed/deployed

- Org dashboard search now performs real work instead of silently falling back
  to the unfiltered raffle list:
  - section keywords such as `dashboard`, `raffles`, `points`, `wallets`,
    `settings`, and `team` jump directly to that org section;
  - `#123` / `123` still opens a raffle detail page;
  - all other text searches the org raffle API by project name, title,
    description, or exact numeric ID.
- `/:org/raffles` now reads the `q` query string, shows search-result copy,
  calls `/api/:org/raffles?q=...`, and exposes a clear-search action.
- Member mobile navigation now opens a drawer/sidebar instead of relying on the
  horizontal tab rail. The drawer includes the member tabs plus a prominent
  `Team dashboards` switcher link so mobile users can get back to org
  dashboards quickly.
- `/me/points` now shows standalone point-earning tasks only. It no longer
  renders live raffle task workspaces inside the Points tab.
- Raffle-specific task gates now route to `/me/raffles?raffle=N`, where members
  can open/verify raffle steps and enter from the same Raffles tab.
- `/me/tasks` remains a hidden compatibility route for older deep links and can
  still render the reusable standalone + raffle task workspace.
- Org dashboard logos now prefer the configured org logo, then fall back to the
  connected Discord guild icon for both the active dashboard and the org
  switcher list, with initials as the final fallback.
- Live Discord raffle embeds now show entries while the raffle is live when
  entries are not hidden.
- Successful Discord enter/leave actions now trigger a targeted refresh of that
  raffle's Discord post so the live entry count catches up immediately.
- Discord task verification feedback now names the exact raffle/project
  (`Project · Title (#id)`) and retries entry for that same raffle, avoiding
  generic feedback when multiple raffles are live in the server.

Verification:

- `corepack pnpm --filter @kos/dashboard typecheck`
- `corepack pnpm --filter @kos/dashboard build`
- `corepack pnpm --filter @kos/bot typecheck`
- `corepack pnpm --filter @kos/bot build`
- `git diff --check`
- Code committed as `52157fd` (`Fix dashboard search and raffle entry UX`) and
  pushed to `origin/main`.
- EC2 bot deployed via `./scripts/deploy-ec2.sh`; Discord slash command count
  remained 7, PM2 reported `kos-bot` online, and the local internal health
  endpoint returned `{"ok":true,"ready":true}`.
- Vercel is expected to auto-deploy the dashboard from the `main` push; no
  Vercel CLI/API credential is available in this local shell to inspect the
  deployment record directly.

No database migration is required; this is a dashboard UI/API routing update
plus a Discord interaction/rendering fix.

### Default raffle channels — committed/pushed/deployed

- Added `Guild.defaultRaffleChannelId` with migration
  `20260709090000_default_raffle_channel`.
- Org Settings now includes a "Default raffle channels" card per connected
  Discord server:
  - raffle post channel;
  - winners announcement channel;
  - proof delivery channel.
- Settings saves through `PATCH /api/:org/guilds/:guildId/defaults`, gated by
  `settings:edit`.
- `/api/:org/guilds` and `/api/:org/guilds/:guildId/meta` now expose channel
  defaults for the Settings card and raffle builder.
- The dashboard New Raffle modal now prefills the selected server's default
  raffle/winner/proof channels, but hosts can still override all three before
  publishing.
- Dashboard raffle creation falls back to the configured default raffle post
  channel when no channel is provided; if neither exists, it returns a clear
  "configure one in Settings" error.
- Discord `/config channels` now accepts a `raffle` channel option and shows the
  configured default raffle channel in `/config show`.
- Discord `/raffle create` now starts from the configured default raffle post
  channel when present, falling back to the current Discord channel otherwise.

Verification:

- `corepack pnpm --filter @kos/db generate`
- `corepack pnpm --filter @kos/db build`
- `corepack pnpm --filter @kos/dashboard typecheck`
- `corepack pnpm --filter @kos/dashboard build`
- `corepack pnpm --filter @kos/bot typecheck`
- `corepack pnpm --filter @kos/bot build`
- `git diff --check`
- Code committed as `bfb09c9` (`Add default raffle channel settings`) and
  pushed to `origin/main`.
- Migration `20260709090000_default_raffle_channel` applied locally using
  `apps/dashboard/.env.local` and applied to production Neon using
  `apps/dashboard/.env.vercel`.
- EC2 bot deployed via `./scripts/deploy-ec2.sh`; Discord slash command count
  remained 7, PM2 reported `kos-bot` online, and the local internal health
  endpoint returned `{"ok":true,"ready":true}`.
- Vercel is expected to auto-deploy the dashboard from the `main` push; no
  Vercel CLI/API credential is available in this local shell to inspect the
  deployment record directly.

### Inline raffle tasks and shared same-link verification — committed/pushed/deployed

- `/me/raffles` now renders each live raffle's task controls directly inside
  the raffle card above the entry checklist, so members can open/verify tasks
  without clicking "Fix it" into a separate focused view.
- The entry checklist still shows unmet task gates, but when inline task
  controls are present it tells members to use the raffle steps above instead
  of linking away.
- Verifying/opening a legacy social/link raffle task now refreshes all live
  raffle cards and entry panels in the member Raffles tab.
- Legacy social/link task logs now include a URL-derived `sharedTaskKey` in
  addition to the existing per-raffle `taskKey`.
- Web task status, web entry gates, and Discord bot entry gates now accept
  either the per-raffle key or the shared URL key. This means once a member
  opens/verifies a specific link, other raffles with that exact same link show
  the matching clicked/verified state and can unlock entry without repeating
  the same task.
- Existing historical logs remain valid because the old `taskKey` path is still
  checked first.

Verification:

- `corepack pnpm --filter @kos/dashboard typecheck`
- `corepack pnpm --filter @kos/dashboard build`
- `corepack pnpm --filter @kos/bot typecheck`
- `corepack pnpm --filter @kos/bot build`
- `git diff --check`
- Code committed as `72c3347` (`Inline raffle tasks and share link
verification`) and pushed to `origin/main`.
- EC2 bot deployed via `./scripts/deploy-ec2.sh`; Discord slash command count
  remained 7, PM2 reported `kos-bot` online, and the local internal health
  endpoint returned `{"ok":true,"ready":true}`.
- Vercel is expected to auto-deploy the dashboard from the `main` push; no
  Vercel CLI/API credential is available in this local shell to inspect the
  deployment record directly.

No database migration is required; this uses existing `Log.metadata`.

### Discord raffle-enter confirmation hardening — committed/pushed/deployed

- Discord raffle entry success replies now explicitly say
  `Raffle entered` and include a disabled per-user Discord button labeled
  `Raffle entered ✓`.
- Duplicate enter clicks also return the same entered state instead of a plain
  text-only "already entered" response, and they trigger a best-effort raffle
  post refresh to catch stale entry-count renders.
- This intentionally does not mutate the public `Enter Giveaway` button into
  `Entered`, because that Discord message is shared by every server member; the
  entered state must be shown in the member's ephemeral interaction response.
- Website enter/leave now sets `Raffle.editRequestedAt` while updating
  `entryCount`, allowing the EC2 bot scheduler to refresh the Discord raffle
  post after web entries and exits.
- No database migration is required; this uses the existing
  `editRequestedAt` dashboard-to-bot mediation flow.

Verification:

- `corepack pnpm --filter @kos/bot typecheck`
- `corepack pnpm --filter @kos/dashboard typecheck`
- `corepack pnpm --filter @kos/bot build`
- `DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder corepack pnpm --filter @kos/dashboard build`
- `git diff --check`
- Code committed as `0102cc9` (`Clarify Discord raffle entry confirmation`)
  and pushed to `origin/main`.
- EC2 bot deployed via `./scripts/deploy-ec2.sh`; Discord slash command count
  remained 7, PM2 reported `kos-bot` online, and the local internal health
  endpoint returned `{"ok":true,"ready":true}`.
- Vercel is expected to auto-deploy the dashboard API update from the `main`
  push; no Vercel CLI/API credential is available in this local shell to
  inspect the deployment record directly.

### Cancelled raffle URL hardening and dashboard repost — committed/pushed/deployed

- Root cause confirmed from production audit rows and EC2 PM2 logs: raffles
  #58-#60 were rejected by Discord with `50035` because legacy task button URLs
  contained trailing spaces. Raffle #57 was published earlier but its later
  message refreshes failed for the same reason.
- Dashboard create/edit APIs now trim and validate HTTP(S) task/project URLs
  before persistence.
- Discord embed/component rendering performs the same validation defensively,
  allowing existing affected rows to publish safely without a data migration.
- Discord publish failures now retain the detailed Discord field error instead
  of replacing it with the generic `Invalid Form Body` summary.
- Cancelled raffle detail pages show the latest publish-failure audit message.
- Users with `raffle:edit` can click **Repost raffle** for an unexpired
  cancelled raffle. The API clears stale message state and returns it to
  `DRAFT`; the EC2 scheduler publishes it on its next tick using the existing
  database-mediated flow. Entries and raffle configuration are preserved.
- Repost is rejected for non-cancelled raffles, expired raffles, missing
  channels, invalid IDs, and out-of-organization records.
- No database migration is required.

Verification:

- `corepack pnpm --filter @kos/bot typecheck`
- `corepack pnpm --filter @kos/bot build`
- `corepack pnpm --filter @kos/dashboard typecheck`
- `DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder corepack pnpm --filter @kos/dashboard build`
- `git diff --check`
- Production-row smoke test built raffle #60's Discord components and confirmed
  the stored task URLs now render without trailing whitespace.
- Code committed as `108acb2` (`Fix cancelled raffle repost flow`) and pushed
  to `origin/main`.
- EC2 bot deployed via `./scripts/deploy-ec2.sh`; PM2 reported `kos-bot` online
  and the internal health endpoint returned `{"ok":true,"ready":true}`.
- Both connected Vercel deployment statuses completed successfully for commit
  `108acb2`.
- Signed-in production browser verification on `raffle.koslabs.app` confirmed
  the cancelled-raffle failure panel, trimmed task links, and **Repost raffle**
  button are live. No raffle was requeued during verification.

### Public raffle sharing and configuration-only duplication — committed/pushed/deployed

- Added canonical anonymous SSR raffle pages at `/r/:id`. Middleware explicitly
  allows this route while `/c/:slug` remains session-gated.
- Public pages show natural-aspect banners, project/community identity, inferred
  GTD/FCFS type, status, spots, visible entry count, schedule, live countdown,
  Discord roles, tasks, rules, winners, and verifiable draw commitment without
  exposing any organization controls or entrant identities.
- Signed-out visitors receive a prominent Discord login CTA that returns to the
  same raffle. Signed-in visitors reuse the existing web gate evaluator and
  enter/leave APIs, so Discord roles and all current eligibility semantics stay
  consistent.
- Added canonical, Open Graph, and Twitter metadata with the banner as the share
  image. Public links use `https://raffle.koslabs.app/r/:id` by default and can
  be overridden at build time with `NEXT_PUBLIC_RAFFLE_ORIGIN`.
- Added accessible Actions menus to live/upcoming dashboard cards, raffle table
  rows, and raffle details. Copy Share Link uses the Clipboard API, a legacy
  copy fallback, and a selectable manual-copy field if both fail.
- Added **Duplicate**, **Duplicate as GTD**, and **Duplicate as FCFS**. Actions
  open the existing raffle builder with source configuration prefilled and a
  fresh duration-preserving schedule. Successful creation redirects to the new
  raffle in edit mode and shows `Raffle duplicated successfully.`
- Duplication preserves banner/project/external links, description, channels,
  roles/match mode, raw custom requirements, legacy tasks, reusable task gates,
  wallet settings, role weighting, visibility, and ping behavior.
- Duplication explicitly does not copy status, participants, winners, entry
  count, message ID, proof, draw seeds/commitments, timestamps, join history, or
  analytics. The new row starts `DRAFT` and uses the existing bot scheduler.
- Existing community/member links and future result notifications now point to
  `/r/:id`.
- No database migration is required; stable existing raffle IDs are canonical.

Verification:

- `corepack pnpm --filter @kos/dashboard typecheck`
- `corepack pnpm --filter @kos/bot typecheck`
- `corepack pnpm --filter @kos/bot build`
- `DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder corepack pnpm --filter @kos/dashboard build`
- Anonymous local production-build QA rendered real raffle #57 without a login
  redirect, confirmed the Discord CTA returns to `/r/57`, and verified canonical,
  Open Graph, Twitter card, and banner metadata.
- `git diff --check`
- Application code committed as `46ec673` (`Add public raffle sharing and
duplication`); the cross-browser quick-action follow-up committed as
  `436e67d` (`Harden raffle quick actions`). Both commits are pushed to
  `origin/main`.
- Both connected Vercel deployment statuses completed successfully for commit
  `436e67d`.
- Anonymous production request to `https://raffle.koslabs.app/r/57` returned
  `200` with canonical URL, `NUTZY · GTD` Open Graph title, and its banner as
  the Open Graph image.
- Signed-in production browser QA confirmed every raffle table row exposes the
  Actions menu; **Duplicate as FCFS** opened a prefilled raffle #57 builder with
  FCFS type, source project/banner/channels/roles/tasks/wallet settings, four
  spots, and fresh timing. The builder was closed without publishing.
- Production browser QA also confirmed **Copy share link** completes without
  navigating away and exposes the selectable
  `https://raffle.koslabs.app/r/57` fallback when clipboard permissions are
  denied.

### Multi-tenant sharing hardening and debt cleanup — committed/pushed/deployed

- Confirmed the production design is multi-tenant: unique
  `GuildConnection.guildId` anchors ownership, and duplicate GET/POST source
  reads use both the source raffle ID and the requesting organization's guild
  IDs.
- Extracted and tested the mandatory duplicate tenant scope. Route tests prove
  an out-of-tenant raffle returns `404` and malformed IDs are rejected before a
  database read.
- Encoded public policy as code-level invariants: positive PostgreSQL `Int`
  identifiers, normalized HTTP(S) origin, and an allowlist of UPCOMING/LIVE/
  ENDED. DRAFT and CANCELLED remain private.
- Replaced the duplicate legacy raffle implementation with a tenant-verified
  permanent redirect from `/c/:slug/raffles/:id` to `/r/:id`.
- Added Framer Motion to raffle action menus, toasts, and the raffle builder.
- Added Vitest and nine focused tests across three files.
- Fixed the root build script by quoting recursive pnpm filters; root
  `pnpm build` now builds DB, bot, and dashboard successfully.
- No schema migration or environment-variable change is required.

Verification:

- `corepack pnpm test` — 3 files, 9 tests passed.
- `corepack pnpm --filter @kos/dashboard typecheck`
- `DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder corepack pnpm build`
- `git diff --check`
- Application committed as `2e6ef94` (`Harden multi-tenant raffle sharing`)
  and pushed to `origin/main`.
- Both connected Vercel deployments completed successfully for `2e6ef94`.
- Production canaries confirmed `/r/57` returns `200`, while cancelled raffle
  `/r/60` and malformed `/r/not-valid` return `404`.
- Anonymous requests to the signed-in compatibility route still pass through
  middleware and return the expected login redirect; after authentication the
  page verifies tenant ownership and permanently redirects to `/r/:id`.

### Member community views and community X branding — committed/pushed/migrated/deployed

- `/me/communities` now has **Your communities** and **Discover all** views,
  counts, joined badges, live-raffle totals, cleaner responsive cards, and
  Discord guild-icon fallback when an organization has no uploaded logo.
- "Your communities" is derived privately from the signed-in user's Discord
  OAuth guild list and matches an organization when any connected guild is
  present. Token/API failure shows a Discord reconnect action instead of a
  misleading zero-community state.
- Organization Settings → Branding now accepts an optional X handle or
  x.com/twitter.com profile URL. The API validates it under `branding:edit`,
  stores only the normalized handle, and keeps the existing organization audit
  entry.
- Community X links render on directory cards, community headers, and the host
  block on canonical public raffle pages. They are plain public branding links,
  not paid X API verification.
- Added additive migration `20260711195000_organization_x_handle` for nullable
  `Organization.xHandle`.
- Added five focused tests for community membership matching and X handle
  normalization, bringing the dashboard suite to 14 tests across five files.

Verification:

- Prisma schema validation passes with Prisma 5.22.0.
- `corepack pnpm test` — 5 files, 14 tests passed.
- `DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder corepack pnpm build`
- `git diff --check`
- Application and migration committed as `64e8158` (`Add member community
views and X profiles`) and pushed to `origin/main`.
- Local production migration attempts could not reach Neon. The existing EC2
  production connection applied migration
  `20260711195000_organization_x_handle` successfully; Prisma reported all 20
  migrations applied.
- Both connected Vercel deployments completed successfully for `64e8158`.
- Production canaries confirmed canonical raffle #57 still returns `200` after
  selecting the new organization field, and signed-out
  `/me/communities?view=all` preserves its login return URL.

### Authenticated community visual regression and OAuth resilience — complete

- Added Playwright with an authenticated global setup that accepts a supplied
  session cookie/storage-state file or signs a 30-minute ordinary KOS session
  from external `DASHBOARD_SESSION_TOKEN` + `KOS_E2E_USER_ID` values. Auth
  state, reports, traces, and failure artifacts are gitignored.
- Added desktop (1440×1000) and Pixel 7 projects covering **Your communities**,
  **Discover all**, joined state, responsive cards, and the Branding/X form.
- Committed six masked visual baselines: mine/all/branding for desktop and
  mobile. Dynamic counts, live status, images, and stored branding values are
  masked with a neutral color so content changes do not create noisy failures.
- The first parallel browser run exposed two real production issues. Discord
  refresh-token rotation is now serialized across Vercel instances with a
  transaction-scoped PostgreSQL advisory lock, and transient guild-list calls
  retry `429`/`5xx` responses.
- EC2 diagnostics confirmed Discord's `Retry-After: 997` header is milliseconds,
  not seconds. The retry parser now supports Discord milliseconds, decimal
  seconds, and JSON `retry_after`, with bounded backoff.
- Visual projects run serially because both intentionally share one test
  Discord identity and its rate-limit bucket. This keeps visual comparison
  deterministic while production retains the concurrency protections above.
- Dashboard Vitest now passes 19 tests across seven files, including token-lock,
  consumed-rotation, rate-limit retry, membership, X normalization, sharing,
  and duplicate tenant-isolation cases.

Verification:

- `corepack pnpm --filter @kos/dashboard test` — 7 files, 19 tests passed.
- `corepack pnpm --filter @kos/dashboard typecheck`
- Dashboard production build passes.
- Baseline generation: `test:e2e:update` — 4 passed.
- Independent visual comparison: `test:e2e` — 4 passed in 24.5 seconds.
- Vercel deployments completed successfully for runtime fix `2ba4343`.
- Commits: `7885db0` (Playwright harness), `ec6820f`/`11ebb03` (distributed
  token refresh hardening), `f08e963`/`2ba4343` (Discord retry handling), and
  `ac2c76b` (visual baselines).

## Confirmed invariants and current product policies

- The active repository is `/Users/adebayodaniel/KOS RAF`; its `origin` is
  `BFA-xx/kos-wl-bot` and the deployment branch is `main`.
- "Active raffles" for the profile Tasks hub is defined as `Raffle.status = LIVE`
  within non-suspended organizations that have connected guilds.
- Active org-created tasks are intended to be visible as standalone earning
  tasks to signed-in members; raffle attachment is only needed when that task
  must gate raffle entry.
- Legacy social/link task verification is intentionally click-and-attest, not
  paid X API verification.
- Vercel auto-deploys pushes to `main`; deployment state is verified through
  the repository's two connected Vercel commit statuses and production route
  canaries.
- "Points channel" means a Discord channel per connected guild where KOS posts
  points/rewards activity and where managers can host `/points panel`.
- Reward fulfillment is manual for now; points spend/refund and stock changes
  are handled automatically.
- X OAuth linking remains web-first; Discord `/tasks verify` can attest X tasks
  after the member has linked X on the web.
- For the UI refresh, preserving existing behavior took priority over replacing
  every manager form/table in one pass. Some lower-traffic setup/admin/support
  surfaces still need deeper product-design passes.
- The attached “KOS Phase 3” specification is the intended roadmap, while the
  code and migrations define what is actually shipped.
