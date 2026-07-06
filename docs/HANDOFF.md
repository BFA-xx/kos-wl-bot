# Engineering Handoff

Last updated: 2026-07-06
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

The next approved development workstream is **S2.5 hardening**. No hardening
application changes have started yet; the current worktree contains only the
takeover documentation listed below.

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
- No automated test files exist.

## Handoff reconciliation

Claude's final message matches the shipped commits and most behavior. Important
precision points:

1. Community pages under `/c/:slug` do not require organization membership,
   but middleware still requires a signed session. They are not anonymous.
2. The new-raffle modal can select verification tasks. The edit API supports
   replacement via `verificationTaskIds`, but the edit page/modal neither loads
   nor sends those IDs, so hosts cannot edit task gates through the UI.
3. X and visit-link tasks are attestations. They prove linked identity/click
   intent, not the underlying follow/like/repost/comment/visit action.
4. Rerolls are deterministic for their generated seed, but that seed is not
   persisted and the refreshed proof still exposes the original raffle draw
   commitment. Reroll reproducibility is therefore incomplete.
5. Billing is hidden from navigation only; `/:org/billing` remains reachable.

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

- Raffle edit replaces roles and raffle-task links in separate operations
  before the final raffle update, not one transaction; a later failure can
  leave partial changes.
- Verification task selections are absent from the raffle detail payload and
  edit modal.
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

Before S3, do a focused S2.5 hardening pass:

1. add raffle task-gate editing to the detail/edit UI;
2. make role/task replacement transactional;
3. persist and expose reroll proof data;
4. correct upload authorization;
5. add focused tests for tenant isolation, eligibility parity, and draw/reroll
   reproducibility;
6. then refresh the public setup/deployment documentation and `.env.example`.

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
deployment, or production state was changed. These documentation changes are
being committed as the final pre-hardening checkpoint.

## Assumptions

- `/Users/adebayodaniel/KOS RAF` is the intended repository because it is the
  only local Git repository matching the handoff and its HEAD exactly matches
  Claude's final commit.
- Claude's production-status statements are historical context until verified
  directly against production.
- The attached “KOS Phase 3” specification is the intended roadmap, while the
  code and migrations define what is actually shipped.
