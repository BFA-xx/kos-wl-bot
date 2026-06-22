# Architecture

## Overview

```
            Discord  ◀──gateway──▶  ┌───────────────────────────┐
                                    │        @kos/bot           │
   members click Enter/Leave  ───▶  │  commands · interactions  │
                                    │  services · scheduler     │
                                    │  proof (pdf/csv/card)     │
                                    │  internal HTTP API :4000  │
                                    └─────────────┬─────────────┘
                                                  │ Prisma
                                                  ▼
                                         ┌──────────────────┐
                                         │   PostgreSQL     │
                                         └────────┬─────────┘
                                                  │ Prisma (read) + actions
                                    ┌─────────────┴─────────────┐
                                    │      @kos/dashboard       │
                                    │   Next.js + Tailwind      │
                                    │   reroll/end ──▶ bot :4000│
                                    └───────────────────────────┘
```

The **bot** owns all Discord side effects. The **dashboard** reads the database
directly (fast) and proxies the few *write* actions that must produce live
Discord messages (reroll, end) to the bot's internal HTTP API.

## Packages

- **`packages/db`** — Prisma schema + a singleton client exported as `@kos/db`.
  Both apps depend on it, so the data model lives in exactly one place.
- **`apps/bot`** — discord.js v14 gateway client.
- **`apps/dashboard`** — Next.js 14 App Router UI + API routes.

## Bot service layer

| Service | Responsibility |
| --- | --- |
| `raffleService` | Raffle CRUD, posting/refreshing the live embed, stats. |
| `eligibilityService` | Role match (ANY/ALL), blacklist, anti-alt checks, reaction gating. |
| `entryService` | Enter/leave inside a transaction; duplicate prevention via a unique index. |
| `winnerService` | Verifiable draw, announcement, reroll; orchestrates wallet DMs + proof. |
| `walletService` | Winner DM forms, validation, encrypted storage, export. |
| `proofService` | Renders PDF + CSV + PNG, persists artifacts, delivers to the proof channel. |
| `blacklistService` | Per-guild blacklist add/remove/list. |
| `scheduler` | Sweep loop: open/close/draw transitions + live embed refresh. |
| `auditService` | Append-only audit log; never throws into the main path. |

## Scheduling model

A single **sweep** (`SCHEDULER_TICK_SECONDS`, default 15s) recomputes state
from the database every tick:

- `UPCOMING` whose `startAt` passed → `LIVE` (+ embed refresh).
- `LIVE` whose `endAt` passed → `closeAndDraw` (draw → announce → wallet DMs → proof).

Because state is derived from the DB rather than in-memory timers, the bot
**survives restarts** and never "forgets" a scheduled raffle. A second loop
(`EMBED_REFRESH_SECONDS`) keeps countdowns/entry counts fresh; entries also
trigger a debounced immediate refresh.

## Verifiable winner draw

1. At draw time the bot generates a random 32-byte `seed` and publishes its
   `SHA-256` commitment (`drawSeedHash`) in the announcement and proof.
2. Each entrant gets a key = `HMAC-SHA256(seed, discordId)`. Entrants are sorted
   by key and the first *N* win — uniform, duplicate-free selection.
3. Anyone can later recompute the keys from the revealed seed + participant list
   and confirm the winners, and check `SHA-256(seed) == drawSeedHash`.

This combines cryptographic randomness (`crypto.randomBytes`) with public
verifiability. See `utils/random.ts`.

## Data model (Prisma)

`Guild`, `User`, `Raffle`, `RaffleRole`, `Participant`, `Winner`, `Wallet`,
`Blacklist`, `Proof`, `Log`. Highlights:

- `Raffle.id` is an auto-increment int and doubles as the human Raffle ID (`#2345`).
- `Participant` has a unique `(raffleId, userId)` — the duplicate-entry guard is
  enforced at the database level, race-safe under concurrent clicks.
- `Winner.replaced` keeps rerolled winners for the audit trail.
- `Wallet.address` stores AES-256-GCM ciphertext when `WALLET_ENCRYPTION_KEY` is set.
- Anti-alt rules live in `Raffle.requirements` (typed/validated with Zod).

## Scalability notes

- All hot-path lookups hit indexed columns (`@@index` on guild/status/endAt,
  unique on participant/winner/blacklist).
- Entry and reroll mutations run in transactions to keep `entryCount` consistent.
- Multiple guilds and simultaneous raffles are first-class (everything is keyed
  by `guildId` / `raffleId`); the single sweep handles any number of raffles.
- Embed edits are throttled/debounced to stay within Discord rate limits.
- For multi-process horizontal scaling, move the per-user rate limiter and
  embed-refresh debounce to Redis (currently in-memory; fine for one process).
