# Engineering Handoff

Last updated: 2026-07-07
Repository: `BFA-xx/kos-wl-bot`
Branch: `main`
Audited commit: `e0bd4c8`

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

The approved development workstream is **S2.5 hardening**. Two hardening slices
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
- No automated test files exist.

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

- No automated tests for draw logic, eligibility parity, tenant isolation,
  OAuth, task verification, wallet validation, or scheduler request handling.
- Root `pnpm build` is broken by shell-expanded `--filter ./apps/**`; package
  builds pass individually.
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

- Proof artifacts live only on EC2 local disk plus Discord delivery.
- Legacy internal control API code/config remains even though production uses
  DB mediation.
- The scheduler is designed for one bot instance; multiple bot instances could
  race on state transitions and queued requests.
- Dependency versions are intentionally old enough to have major upgrades
  available (Prisma 5, Next 14); do not upgrade incidentally.

## Recommended next task

Continue the focused S2.5 hardening pass before S3:

1. persist and expose reroll proof data;
2. correct upload authorization;
3. add focused tests for tenant isolation, eligibility parity, and draw/reroll
   reproducibility;
4. then refresh the public setup/deployment documentation and `.env.example`.

After that, S3 can add `PointsLedger`, campaigns, rewards, redemptions, and the
participant hub without building on ambiguous S2 behavior.

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

Verification: dashboard typecheck and production build pass. No database,
Discord, or browser integration smoke test was run, and the repository still
has no automated test harness.

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

### Typography follow-up — complete locally

- The dashboard now loads a real self-hosted Inter font through
  `next/font/local` instead of relying on device/system fallback fonts.
- The font files are existing tracked assets, so the dashboard build does not
  depend on Google Fonts or another external font CDN.
- Global typography now routes through `--font-kos-sans` and enables Inter's
  readability alternates for cleaner UI text rendering.

Verification:

- `corepack pnpm --filter @kos/dashboard typecheck`
- `git diff --check`
- `DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder corepack pnpm --filter @kos/dashboard build`

## Assumptions

- `/Users/adebayodaniel/KOS RAF` is the intended repository because it is the
  only local Git repository matching the handoff and its HEAD exactly matches
  Claude's final commit.
- "Active raffles" for the profile Tasks hub means `Raffle.status = LIVE`
  within non-suspended organizations that have connected guilds.
- Legacy social/link task verification is intentionally click-and-attest, not
  paid X API verification.
- Vercel is configured to auto-deploy pushes to `main`; the route-canary checks
  confirm the new points routes are present in production, but no Vercel CLI or
  authenticated GitHub status tooling was available in this local environment
  to inspect the deployment record directly.
- For the UI refresh, preserving existing behavior took priority over replacing
  every manager form/table in one pass. Some lower-traffic setup/admin/support
  surfaces still need deeper product-design passes.
- The attached “KOS Phase 3” specification is the intended roadmap, while the
  code and migrations define what is actually shipped.
