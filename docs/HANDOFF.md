# Engineering Handoff

Last updated: 2026-07-07
Repository: `BFA-xx/kos-wl-bot`
Branch: `main`
Audited commit: `2542f6c`

## Current state

Phase 3 is implemented through S2.5:

- S1: Discord-backed participant account, `/me`, X OAuth linking, history.
- S2: reusable task definitions/completions, org builder/review queue, raffle
  task gates, bot inline Discord-task verification.
- S2.5: web raffle entry/leave and gate checklist, member wallet CRUD,
  community directory/pages, winner/result/announcement notifications, member
  login routing.
- Follow-up: database-backed bot heartbeat and Billing hidden from org nav.

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

Claude reported the production database migrated, the bot online in two
guilds, and the Vercel dashboard deployed. This audit verified the repository
and local builds only; it did not query production, Vercel, EC2, Discord, or
Neon.

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

## Assumptions

- `/Users/adebayodaniel/KOS RAF` is the intended repository because it is the
  only local Git repository matching the handoff and its HEAD exactly matches
  Claude's final commit.
- "Active raffles" for the profile Tasks hub means `Raffle.status = LIVE`
  within non-suspended organizations that have connected guilds.
- Legacy social/link task verification is intentionally click-and-attest, not
  paid X API verification.
- Claude's production-status statements are historical context until verified
  directly against production.
- The attached “KOS Phase 3” specification is the intended roadmap, while the
  code and migrations define what is actually shipped.
