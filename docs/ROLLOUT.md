# Wider Rollout Runbook

This runbook covers controlled expansion of the KOS Discord bot beyond the
current early production guilds. It does not replace `docs/DEPLOYMENT.md` or
the incident checks in `docs/HANDOFF.md`.

## Readiness boundary

The current architecture is suitable for a **controlled beta up to 75
guilds** on one bot process, subject to observed EC2, PostgreSQL, and Discord
rate-limit headroom. Do not market an unrestricted 100+ guild launch until the
Discord application is verified and the privileged Server Members Intent is
approved for the verified bot.

Before approximately 2,500 guilds, implement Discord gateway sharding and a
distributed scheduler lease/queue. The current scheduler intentionally assumes
one active PM2 process.

## Discord application checklist

In the Discord Developer Portal:

1. Enable **Guild Install** with `bot` and `applications.commands` scopes.
2. Enable **Server Members Intent**. KOS needs it for membership, role, and
   server-age eligibility checks.
3. Use this minimum-permission install URL, replacing the client ID:

   ```text
   https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=248832&scope=bot%20applications.commands
   ```

   Permission integer `248832` grants View Channels, Send Messages, Embed
   Links, Attach Files, Read Message History, and Mention Everyone. Remove
   Mention Everyone in the URL if communities do not need live raffle pings;
   `/config diagnose` reports the permissions that configured channels need.

4. Before 100 guilds, submit Discord application verification and the
   privileged-intent approval. Start that process early; it is an external
   launch dependency.
5. Register production commands globally:

   ```bash
   pnpm --filter @kos/bot deploy:commands -- --global
   ```

   A configured development guild is mirrored during registration so its old
   guild command override cannot hide newer global definitions.

## Community onboarding

An administrator should complete this sequence in every new server:

1. Install the bot with the approved URL.
2. Connect the Discord guild to the intended KOS organization.
3. Run `/config channels` and set raffle, winner announcement, proof, and
   points/rewards channels.
4. Add operational roles with `/config managers add`.
5. Run `/config diagnose` and resolve every missing channel, permission, or web
   connection warning.
6. Create a short, low-stakes test raffle; enter from one ordinary member
   account; close it; confirm the announcement and all proof artifacts.
7. Test `/tasks`, `/points`, `/rewards`, and `/wallet register` from an ordinary
   member account, not only an administrator account.

Configured manager roles are authorized at runtime. `/raffle` and `/blacklist`
remain visible to ordinary members so Discord's default permission gate cannot
hide them from a configured manager role; unauthorized attempts receive an
ephemeral denial.

## Rollout stages

### Stage 1 — 3 to 25 guilds

- Onboard communities individually and retain a named admin contact.
- Check `/admin/health`, EC2 PM2 state, Discord warnings, and scheduler logs
  after every cohort.
- Keep `SCHEDULER_BATCH_SIZE=25` unless observed tick duration approaches the
  configured tick interval.
- Record onboarding failures and support questions before changing the UX.

### Stage 2 — 25 to 75 guilds

- Measure scheduler tick duration, queued batch warnings, EC2 memory/CPU,
  PostgreSQL connections/latency, Discord 429s, publish failures, and proof
  generation time.
- Stop adding cohorts if a normal scheduler tick cannot drain work before the
  next interval or if batch-limit warnings persist.
- Exercise recovery: restart PM2 during a test raffle and confirm the database-
  driven scheduler catches up without a duplicate draw.

### Stage 3 — 75 to 100 guilds

- Require completed Discord verification and Server Members Intent approval.
- Define support ownership, incident response, data deletion, and privacy
  contacts before public promotion.
- Run a load rehearsal with simultaneous publish, entry, close, reroll, task,
  points, and proof activity.

## Deploy and smoke check

`scripts/deploy-ec2.sh` now fails on dependency, test, build, global command
registration, PM2 restart, or scheduler-health failure. It never copies `.env`
files.

After deployment, verify:

```bash
curl -fsS http://127.0.0.1:4000/internal/health
pm2 status kos-bot
pm2 logs kos-bot --lines 100 --nostream
```

Healthy JSON includes `ready: true`, the connected guild count, and a scheduler
object with a recent `lastTickAt` and `lastTickOk: true`.

## Protected visual CI setup

The `Authenticated visual regression` workflow intentionally uses a protected
GitHub environment named `visual-regression` and an ordinary, non-admin KOS
test user. A repository administrator must create the environment, add a
required reviewer, and set these environment secrets:

- `DASHBOARD_SESSION_TOKEN`: the same session-signing secret used by the
  production dashboard.
- `KOS_E2E_USER_ID`: the Discord ID of the dedicated ordinary visual-test user.

Do not store a reusable browser state or session cookie in Git. Fork pull
requests do not receive these credentials and the protected job is skipped.
Failed runs upload the Playwright report, traces, screenshots, and image diffs
for 14 days.

## Current product boundaries

- X follow/like/repost verification is click-and-attest, not a paid engagement
  API check.
- Wallet validation checks address format, not ownership.
- Reward fulfillment remains an organization-team workflow.
- Rerolls do not yet persist an independent seed/commitment.
- Proof generation is bot-host work and can become a throughput bottleneck.

These boundaries must be stated accurately in onboarding and support material.
