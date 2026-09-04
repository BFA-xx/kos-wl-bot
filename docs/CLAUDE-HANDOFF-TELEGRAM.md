# Claude Handoff: KOS Telegram Bot

Last updated: 2026-09-03

Repository: `/Users/adebayodaniel/KOS RAF`

Remote: `https://github.com/BFA-xx/kos-wl-bot.git`

Branch: `main`

Production dashboard: `https://raffle.koslabs.app`

Production Telegram community chat ID: `-1004300905705`

Production bot username: `@KOSRafflesBot`

## Read This First

1. Read `docs/AGENTS.md` for repository-wide architecture and safety rules.
2. Run `git status --short`, `git log -5 --oneline`, and `git rev-parse
origin/main` before changing anything.
3. Treat this file as the focused Telegram handoff. `docs/HANDOFF.md` contains
   the longer product history, including older snapshots that may be stale.
4. Never paste, print, commit, or transmit Telegram tokens, webhook secrets,
   database credentials, wallet keys, or Discord credentials.
5. Do not modify or restart Mintooor or Bottavious. KOS Bot is independent.
6. KOS Raffle remains authoritative for raffle state, eligibility, entries,
   winners, and publication. Telegram is an interaction adapter.

## Product Goal

KOS Bot is the Telegram entry point for KOS identity, community onboarding,
team approval, raffles, points, referrals, notifications, and administration.
Anyone may create a private KOS identity. Community access remains pending
until a current Telegram group administrator with the required KOS team
permission approves it.

The intended member journey is:

```text
Join connected Telegram community
  -> tagged public welcome
  -> private KOS Bot deep link
  -> guided five-step onboarding
  -> pending community access request
  -> private notification to eligible reviewers
  -> private approve/reject action
  -> private member result and one-use join link when needed
  -> raffles, points, referrals, and profile
```

## Current Release Baseline

The prior production baseline is commit `d079d52`, which added direct private
use of `/approvals`, `/quickraffle`, and `/settings`. The next commit containing
this document adds the guided onboarding engagement described below. Resolve
its exact SHA with `git log -1 --oneline` rather than hardcoding a self-
referential commit hash here.

Important preceding commits:

- `d079d52`: direct private Telegram admin tools with community discovery.
- `740189e`: private approval, quick-raffle, and settings workflows.
- `e702857`: approval of users outside the group and one-use invite delivery.
- `19fa6c4`: reconciliation of direct Telegram onboarding.
- `03407e7` and `22ae97c`: integrated Telegram phases and production fixes.

## Runtime Ownership

### Vercel dashboard and Telegram webhook

`apps/dashboard` is a Next.js 14 application. The authenticated Telegram
webhook is:

```text
POST /api/integrations/telegram/webhook
```

The webhook validates `X-Telegram-Bot-Api-Secret-Token`, records update IDs to
prevent replay, then passes updates into the grammY handler graph in
`apps/dashboard/lib/telegram-bot.ts`.

This runtime owns:

- `/start` and private navigation.
- Guided onboarding and access status.
- Group `chat_member` welcomes.
- Private approval and administration callbacks.
- Telegram raffle browsing and entry callbacks.
- Quick-raffle setup.
- Points, leaderboard, referrals, and notification settings.

Pushes to `main` deploy two Vercel production projects. Both GitHub commit
statuses must succeed:

- `Vercel - kos-wl-bot-dashboard`
- `Vercel - kos-wl-bot-dashboard-3a8x`

### EC2 KOS bot and scheduler

`apps/bot` runs on EC2 under PM2 as `kos-bot`. It owns Discord behavior and the
durable scheduler that consumes `IntegrationDelivery`, including scheduled
Telegram raffle publications and reminders.

The standard deployment command is:

```bash
./scripts/deploy-ec2.sh
```

Do not restart EC2 for dashboard-only webhook handler changes. Deploy EC2 when
`apps/bot`, shared database runtime behavior, or scheduled Telegram delivery
code changes.

## Telegram Modules

- `apps/dashboard/lib/telegram/access.ts`: combines immutable Telegram user
  identity, current Telegram administrator status, organization status, KOS
  ownership/membership, and granular KOS permissions.
- `apps/dashboard/lib/telegram/admin.ts`: private approval queue, approval
  decisions, moderation, settings, announcements, statistics, and point awards.
- `apps/dashboard/lib/telegram/community.ts`: `/chatid`, durable group member
  tracking, immutable-ID mentions, and state-aware public welcomes.
- `apps/dashboard/lib/telegram/engagement.ts`: feature-gated `gm`/`gKOS`
  recognition and direct `gKOS🖤` group replies with flood limits.
- `apps/dashboard/lib/telegram/entry-requirements.ts`: private named checklist,
  deduplicated remediation links, and same-publication entry retry for failed
  Telegram raffle gates.
- `apps/dashboard/lib/telegram/identity.ts`: provider-neutral KOS identity
  creation and safe bridging to the existing Discord-backed `User`.
- `apps/dashboard/lib/telegram/navigation.ts`: `/start`, menus, profile,
  access status, admin entry, deep links, and the five-step onboarding UI.
- `apps/dashboard/lib/telegram/onboarding.ts`: completion, approval-activated
  reward, referral completion, and idempotent private reviewer notifications.
- `apps/dashboard/lib/telegram/raffle-topic.ts`: `/raffletopic`, which stores
  the forum topic raffle messages are posted into.
- `apps/dashboard/lib/telegram/raffle-access.ts`: the single eligibility
  evaluation shared by the raffle card and the Enter button, plus durable
  `TelegramCommunityMember` reconciliation.
- `apps/dashboard/lib/telegram/raffles.ts`: private raffle list/entry history
  and durable private quick-raffle setup.
- `apps/dashboard/lib/telegram/points.ts`: configurable KOS point ledger and
  leaderboard summaries.
- `apps/dashboard/lib/telegram/referrals.ts`: personal invite codes and
  completion after approved onboarding.
- `apps/dashboard/lib/telegram/notifications.ts`: private member preferences.
- `apps/dashboard/lib/telegram/format.ts`: HTML escaping and strict deep-link
  parsing.
- `apps/dashboard/lib/telegram/rate-limit.ts`: database-backed rate limits.
- `apps/dashboard/scripts/register-telegram-commands.ts`: private-chat and
  group-admin Telegram command scopes.

## Guided Onboarding

The current onboarding flow is intentionally short and uses inline callbacks:

1. `onboarding:start`: welcome and scope of the setup.
2. `onboarding:telegram`: confirms the private Telegram session and explains
   that the immutable numeric user ID, not username, is authoritative.
3. `onboarding:identity`: creates/displays the KOS identity and advances
   `KosIdentity.onboardingStatus` from `STARTED` to `PROFILE_COMPLETE`.
4. `onboarding:connections`: shows existing KOS profile and wallet connection
   status. Both are optional. Wallet addresses are never displayed.
5. `onboarding:review`: displays the community request and current connection
   state before submission.
6. `onboarding:submit`: completes identity onboarding, reconciles community
   membership, creates or retains the pending request, privately notifies
   eligible reviewers, and renders the outcome.

Although the UI labels this as five steps, submission is the action at the end
of Step 5. The old `onboarding:complete` callback remains as a compatibility
alias that opens the review screen instead of bypassing the new flow.

Onboarding is resumable:

- `STARTED` returns to the welcome/start path.
- `PROFILE_COMPLETE` resumes at optional connections.
- `COMPLETED` opens the normal member menu or current access outcome.

`ONBOARDING_COMPLETED` points are not issued merely for pressing Submit. They
are awarded idempotently by `activateApprovedOnboarding` after an authorized
reviewer approves community access. Referral completion uses the same approval
boundary.

### Leave and reapply lifecycle

Leaving a Telegram community changes only
`TelegramCommunityMember.status` to `LEFT`; it does not delete the global KOS
identity, linked profile, wallet history, points, referrals, or raffle history.
When a completed member has a `LEFT` membership whose previous approval is
`APPROVED` or `REJECTED`, both `/start` and `/status` offer `Apply again`.

The reapplication carries the community ID through all five callback steps.
Only the final `onboarding:submit:<communityId>` action changes the membership
back to `PENDING`, refreshes `requestedAt`, clears the previous reviewer fields,
and creates `TELEGRAM_ACCESS_REAPPLIED` audit evidence. The member stays `LEFT`
until they use the new invite after approval. Banned, active, and
already-pending memberships cannot be restarted.

Do not reset `KosIdentity.onboardingStatus` to implement reapplication. That
identity is global and may represent access to several communities. The five
screens rerun as a community application while preserving the identity.

## Reviewer Engagement

When a pending member submits onboarding,
`notifyTelegramOnboardingAdmins` does the following:

1. Loads pending community requests for that identity.
2. Checks `AuditLog` for `TELEGRAM_ACCESS_REVIEW_REQUESTED` created at or after
   the membership's current `requestedAt`, so the same application does not
   repeatedly notify reviewers but a later reapplication can notify again.
3. Calls Telegram `getChatAdministrators` for the connected group.
4. Ignores bots.
5. Calls `telegramActorHasPermission` for each administrator with
   `member:manage`.
6. Sends eligible reviewers a private message with a `Review request` button.
7. Records an organization audit row only when at least one private delivery
   succeeds.

Telegram bots cannot initiate a private chat with someone who has never opened
the bot. If no eligible reviewer can receive the DM, the pending request still
appears under `/approvals` and no sensitive group message is posted.

## Admin Privacy Model

Telegram does not provide Discord-style ephemeral messages inside ordinary
groups. Never claim otherwise. The implemented equivalent is private DM:

- `/approvals`, `/quickraffle`, and `/settings` work directly in KOS Bot DM.
- They also work as group shortcuts. After authorization, the triggering group
  command is deleted and the workflow moves to DM.
- If an admin manages several eligible communities, the bot shows a private
  community picker.
- Every private callback rechecks current Telegram admin status and the exact
  KOS permission. Forwarded/stale buttons do not bypass authorization.
- Approval queue contents, setup prompts, buttons, and confirmations never
  appear in the group.
- The applicant receives their own result privately. A rejected applicant can
  check status; an approved applicant receives profile/raffle actions and a
  one-use, 24-hour group invite when they are currently outside the group.

Do not weaken this to a single cached role check. Both provider and KOS
authorization are deliberate boundaries.

## Group Welcome Behavior

`community.ts` listens only for real `chat_member` transitions. It ignores
bots and non-join updates. The entering person is mentioned by immutable
Telegram ID so the welcome works even without a username.

The welcome varies by durable state:

- New/incomplete identity: start guided onboarding.
- Completed identity with pending access: track private team review.
- Approved access: welcome back and open raffles/points/profile.
- Rejected access: check current status privately.

The group sees a community welcome and safe CTA. Approval controls and member
review data remain private.

## Greeting Engagement

`engagement.ts` is registered before the general interaction rate limiter so a
matching group greeting can use its own limits. Non-command group text bypasses
the general interaction bucket, preventing a database write for every ordinary
message when Telegram delivers all group traffic.

The matcher recognizes standalone, case-insensitive `gm` and `gKOS` tokens in
phrases or punctuation, but does not match embedded letters such as
`programming`, `segment`, `gmos`, or `gkoss`. It ignores private chats,
commands, bots, disabled/unconnected communities, and communities without the
`GREETINGS` feature. A successful response replies to the triggering message
with exactly `gKOS🖤`.

Greeting replies are silently capped at two per user per group and fifteen per
group in each shared one-minute window. Do not remove the chat-level limit
without considering Telegram flood limits and webhook retry behavior.

## Data Model

Relevant Prisma models are in `packages/db/prisma/schema.prisma`:

- `KosIdentity`: provider-neutral identity and onboarding state.
- `IdentityAccount`: immutable provider external ID plus mutable display data.
- `ConnectedAccount`: compatibility bridge used by current KOS web/raffle
  authorization.
- `TelegramCommunity`: organization-owned group, backing guild, feature flags,
  permissions, and raffle defaults.
- `TelegramCommunityMember`: Telegram membership state plus KOS approval state.
- `TelegramConversation`: durable private quick-raffle state.
- `TelegramRafflePublication`: Telegram presentation of an existing raffle.
- `IntegrationActionToken`: expiring callback capabilities.
- `IntegrationDelivery`: durable scheduled cross-platform side effects.
- `KosPointTransaction`, `KosRewardDefinition`, and `KosLevel`: configurable
  points and reputation progression.
- `AuditLog`: organization-scoped approval and notification evidence.

Important state separation:

```text
TelegramCommunityMember.status
  ACTIVE | LEFT | BANNED

TelegramCommunityMember.approvalStatus
  PENDING | APPROVED | REJECTED
```

A user may be `LEFT` and `PENDING`. Approval then creates a one-use invite.
Do not require physical group membership to exist before a team can approve a
valid onboarding request.

## Raffle Boundary

Do not build a second raffle engine in Telegram. `Raffle` remains the source of
truth. Telegram publications, callbacks, and eligibility rules refer back to
the same record used by Discord and web.

Automatic Telegram publication occurs only after authoritative Discord raffle
publication succeeds and only for active communities with
`AUTO_ANNOUNCEMENTS`. Manual `/raffle publish <id>` is a protected fallback.
Quick raffle creates a validated KOS Raffle draft for the existing scheduler;
its multi-step setup is private.

## Raffle Eligibility

The raffle card used to advertise "standard KOS checks" beside an Enter button,
and the member discovered the real verdict only after tapping, as one of seven
callback alerts. `evaluateTelegramRaffleAccess` is now the one evaluation the
card and the button both run, so what a member is shown and what happens when
they tap cannot drift apart. Do not add an eligibility check to one without the
other — a second copy is the same parallel-state mistake the KOS points ledger
made.

The order of checks is deliberate:

```text
community membership -> KOS approval -> linked KOS profile
  -> raffle status -> already entered -> web gates -> Discord membership
```

Discord REST is last so a member blocked earlier never pays for that call, and
`evaluateWebGates` is only reached once cheaper checks pass. Checks after a
block are reported as `pending`, not `fail`, because they were never evaluated.

`alreadyEntered` is a state, not a failure: it swaps the Enter button for Leave.
When every check passes but the group's entry token has expired, the card offers
the website rather than silently dropping the button.

Membership reconciliation is shared by the preview and the entry path, so
opening a card refreshes stale `TelegramCommunityMember` rows exactly as
entering did.

When Telegram entry fails `evaluateWebGates`, do not flatten its reasons into a
callback alert. `sendTelegramEntryRequirements` privately names each failed
gate, links directly to each provider action, deduplicates shared KOS task-panel
links, and includes `Retry entry` using the same unexpired publication action
token. Legacy and Task Engine steps still use the authenticated KOS
click-and-attest UI; Telegram must not mark them verified merely because a
member pressed Enter.

## Raffle Topics

Forum groups can route KOS raffle messages to one topic. The thread id lives in
`TelegramCommunity.defaultRaffleSettings.raffleTopicId` — deliberately in the
existing JSON column, so turning this on needs no migration.

`/raffletopic` run inside a topic sets it, `clear` returns to the main chat, and
`show` reads it. Telegram exposes no way to name or list topics through the Bot
API, so being inside the topic is the only reliable way to identify one; the
command reads `message_thread_id` off its own message.

The post, the ten-minute reminder and the results all send with
`message_thread_id`. `editMessageText` does not take one — the message id
already identifies the thread — and the live raffle post refreshes through that
edit path.

A topic can be closed or deleted, or the group can stop being a forum, long
after an admin configured it. `sendToCommunity` in
`apps/bot/src/services/telegramService.ts` detects those specific Telegram
errors and retries in the main chat, so a stale topic degrades to the old
behaviour rather than burning eight delivery retries and losing the
announcement. Unrelated failures pass through untouched so the existing retry
and backoff still apply. If you add a fourth raffle message, send it through
that helper.

This spans runtimes: the setting is read by `apps/bot` through `packages/db`, so
changing it needs an EC2 deploy, not only Vercel.

## Web Parity

Member-facing KOS state must be readable on the website in the same change that
adds it to Telegram. Points, levels, referrals, community access and
notification preferences are keyed on `KosIdentity`; `lib/kos/member.ts` reads
them for `/me` through the unique `KosIdentity.legacyUserId` bridge, and
`lib/kos/notifications.ts` holds the one preference vocabulary both surfaces use.

Two point systems coexist deliberately and must not be confused:

```text
KosPointTransaction  identity-keyed, global   <- KOS Bot, /me KOS section
PointsLedger         org + Discord user       <- Discord, web, rewards store
```

They cannot be merged as they stand: `PointsLedger.userId` is non-null, and a
Telegram-first identity has no Discord `User` row. Label them distinctly in any
new surface rather than summing them.

## Feature Flags

Telegram community behavior is controlled by `TelegramCommunity.featureFlags`.
Current vocabulary includes:

```text
GREETINGS
ONBOARDING
RAFFLES
QUICK_RAFFLES
POINTS
REFERRALS
MODERATION
ANNOUNCEMENTS
AUTO_ANNOUNCEMENTS
MEMBERSHIP_CHECKS
```

Recheck current production values before assuming a feature is enabled.

## Commands

Private member commands:

```text
/start
/menu
/profile
/status
/raffles
/entries
/points
/leaderboard
/invite
/notifications
/admin
```

Private admin commands are also registered in the private command scope:

```text
/approvals
/quickraffle
/settings
```

Group administrators receive the protected group command scope for approvals,
raffle publication/creation, statistics, announcements, point awards, member
inspection, moderation, settings, chat ID, and quick-raffle cancellation.

## Security Boundaries

- Stable Telegram numeric IDs are identity and authorization inputs. Usernames
  are display metadata only.
- Webhook secret comparison is timing-safe.
- Deep-link payloads are strict and server-validated.
- Callback IDs are bounded before database lookup.
- Community actions require active community state and relevant feature flag.
- Admin actions require both live Telegram administrator status and granular
  KOS permission.
- Wallet addresses are never shown in Telegram onboarding.
- Approval rewards and referrals are idempotent.
- Reviewer notifications are private and audit-deduplicated.
- Production QA must not create fake members, raffles, entries, winners, or
  point transactions unless the user explicitly authorizes a controlled test.

## Verification Commands

Run from the repository root:

```bash
pnpm prettier --check \
  apps/dashboard/lib/telegram \
  apps/dashboard/scripts/register-telegram-commands.ts

pnpm --filter @kos/dashboard typecheck
pnpm --filter @kos/dashboard test
pnpm --filter @kos/dashboard build
git diff --check
```

The standalone dashboard lint script currently opens Next.js's interactive
ESLint setup because no ESLint configuration exists. Do not claim it passed.
The production build still performs Next.js lint/type validation.

Targeted tests include:

- `apps/dashboard/lib/telegram.test.ts`
- `apps/dashboard/lib/telegram/identity.test.ts`
- `apps/dashboard/lib/telegram/access.test.ts`
- `apps/dashboard/lib/telegram/onboarding.test.ts`
- `apps/dashboard/lib/telegram/points.test.ts`

## Production Release Procedure

For dashboard-only Telegram handler changes:

1. Run formatting, typecheck, the full dashboard test suite, production build,
   and `git diff --check`.
2. Commit and push `main`.
3. Wait for GitHub `Typecheck, test, and build` to succeed.
4. Wait for both Vercel production statuses to succeed.
5. Smoke `https://raffle.koslabs.app/api/integrations/telegram/webhook` with an
   invalid secret and require `401`. Never send a valid production update as a
   smoke test.
6. If the Telegram command arrays changed, run command registration using the
   protected production token without printing it.
7. Verify `getWebhookInfo` reports no error and no unexpected backlog.
8. Perform the human Telegram acceptance path below.

For schema changes, back up and validate the production database first, apply
the migration before dependent runtimes, then deploy Vercel and EC2 as needed.
See the historical evidence at the top of `docs/HANDOFF.md` for the established
backup and migration procedure.

## Human Acceptance Test

Use one real admin account and one ordinary second account. Do not use
Heisenberg when the intended second account is `cryptowhale74`.

1. Confirm KOS Bot is an administrator in chat `-1004300905705` with permission
   to invite, restrict, and delete messages.
2. Join or rejoin with the ordinary account.
3. Confirm the group welcome tags that exact entering account.
4. Tap `Start KOS Bot` and complete all five private onboarding steps.
5. Confirm optional profile/wallet actions can be skipped.
6. Confirm the review screen names the intended community.
7. Submit and confirm the member sees `ONBOARDING SUBMITTED`.
8. Confirm an eligible KOS reviewer receives one private notification.
9. Run `/approvals` in the admin's private bot chat.
10. Confirm the exact ordinary account appears once.
11. Approve it.
12. If the ordinary account is outside the group, confirm a one-use join button
    arrives privately. If already inside, confirm access becomes active without
    an invite.
13. Confirm onboarding points are awarded once, not on repeated callbacks.
14. Confirm `/status`, `/profile`, `/raffles`, and `/invite` reflect approval.
15. Confirm no approval list, setup prompt, or reviewer action was posted in
    the public group.
16. Run `/quickraffle` privately and stop at final confirmation unless a real
    production raffle creation is explicitly authorized.
17. After approval, leave the group with the ordinary account.
18. Send `/start` privately and confirm `Apply again: KOS` appears (or the
    connected community's current configured name).
19. Rerun all five steps and submit the new request.
20. Confirm the reviewer receives one new private alert, the queue shows the
    account as needing an invite, and the old identity/points remain unchanged.
21. Confirm a second press on the old Submit button cannot create another
    application or duplicate reviewer notification.
22. In the connected group, send `gm everyone` from a human account and confirm
    KOS Bot replies directly with `gKOS🖤`.
23. Confirm `programming`, `/gm`, a bot-authored message, and a private `gm` do
    not trigger the community greeting reply.
24. Press Enter on a Telegram raffle with incomplete tasks and confirm the
    callback says a private checklist was sent rather than repeating one reason.
25. Complete the named steps from the private action, return to KOS Bot, press
    `Retry entry`, and confirm the normal gate checker records the entry.

## Known Limitations and Next Work

- Telegram has no Discord-style role-scoped ephemeral group messages. Private
  DM is the intentional security design.
- A bot cannot DM an administrator who has never pressed Start. The approval
  queue remains the fallback.
- The five-step onboarding is callback-driven and uses durable identity state,
  but it does not persist the exact visual step. `PROFILE_COMPLETE` resumes at
  optional connections; this is intentional for the current MVP.
- Reapplication preserves one membership row per Telegram user and community.
  `requestedAt` identifies the current review cycle; historical approvals and
  reapplications remain available in `AuditLog` rather than duplicate rows.
- Profile and wallet linking leave Telegram for the authenticated KOS web
  surface. Telegram refreshes connection status after the user returns.
- Mintooor integration is represented in the provider-neutral identity model
  but no Mintooor code is imported. Preserve that boundary.
- A Mini App, richer reputation inputs, onboarding analytics/funnel reporting,
  scheduled pending-review reminders, and configurable community-specific
  onboarding copy are reasonable next phases.
- Production usernames, membership states, queue contents, webhook backlog,
  environment variables, and deployment IDs are time-sensitive. Re-query them
  instead of trusting this handoff.

## Stop Conditions

Stop and ask before:

- Spending funds or signing any wallet transaction.
- Sending a real raffle, announcement, moderation action, or point award as a
  production test.
- Rotating or exposing any credential.
- Reverting unrelated user changes.
- Modifying Mintooor/Bottavious.
- Applying a destructive migration or deleting production data.
