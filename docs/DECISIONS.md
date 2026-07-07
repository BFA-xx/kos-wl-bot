# Architecture and Product Decisions

This is a concise decision log reconstructed from the implementation, commit
history, and the locked Phase 3 plan during the 2026-07-06 takeover audit.
Repository code remains authoritative if this document drifts.

## D001 — Discord identity is the global KOS account

**Status:** Accepted
**Decision:** Use the Discord snowflake as `User.id`. Discord OAuth is the
primary login; external identities attach through `ConnectedAccount`.
**Why:** Bot participants and web participants become the same durable user
without an identity-matching layer.

## D002 — Organizations isolate existing guild-owned raffle data

**Status:** Accepted
**Decision:** A Discord guild can belong to only one organization. Organization
access to legacy raffle data is the set of rows belonging to its connected
guild IDs. Organization-native data uses `organizationId`.
**Why:** Phase 2 could become multi-tenant additively without rewriting the
bot's established guild schema.

## D003 — Dashboard authorization is server-side and permission-based

**Status:** Accepted
**Decision:** Use `requireUser`, `requireOrgAccess`, and `requireSuperAdmin` for
authorization. Organization roles store canonical permission strings; owners
implicitly pass all permissions.
**Why:** UI visibility cannot be the security boundary, and each org needs
delegable operational roles.

## D004 — Vercel and the bot coordinate through PostgreSQL

**Status:** Accepted; legacy API retained
**Decision:** Production publish/edit/end/reroll requests are expressed in
database state and consumed by the bot scheduler. The localhost control API is
not the production integration path.
**Why:** A Vercel function cannot reach `127.0.0.1` on EC2, while both services
already share PostgreSQL.

## D005 — The bot remains authoritative for Discord-side effects

**Status:** Accepted
**Decision:** Only the long-running bot publishes or edits Discord messages,
performs scheduled/final draws, announces winners, sends wallet DMs, and
generates proof packages.
**Why:** These operations require the connected Discord client and reliable
background execution unavailable in serverless dashboard requests.

## D006 — Raffle draws are deterministic from a committed random seed

**Status:** Accepted
**Decision:** Generate a cryptographically random seed, store its SHA-256
commitment, rank candidates by HMAC-SHA256 of the user ID, and choose the first
N unique candidates.
**Why:** The draw can be reproduced after seed disclosure while remaining
unpredictable before the draw. Reroll proof persistence is an acknowledged gap.

## D007 — Wallets use a reusable registry with format-level validation

**Status:** Accepted
**Decision:** Keep one `WalletProfile` per user/chain, usable from Discord and
web. Winner-specific wallets override the profile in exports. Validate address
format only; do not add signature or on-chain ownership verification in this
phase.
**Why:** Reuse reduces payout friction, while wallet-signature/NFT verification
was explicitly deferred because of user-trust concerns.

## D008 — Sensitive values reuse one AES-256-GCM envelope

**Status:** Accepted
**Decision:** Encrypt wallet addresses and OAuth tokens with the existing
`enc:v1:<iv>:<tag>:<ciphertext>` format using `WALLET_ENCRYPTION_KEY`.
**Why:** A shared, backward-compatible implementation already existed and works
in both runtimes. The same key is required on EC2 and Vercel.

## D009 — X verification is link plus attestation for Phase 3

**Status:** Accepted
**Decision:** X OAuth 2.0 PKCE proves ownership of a stable X identity. Follow,
like, repost, and comment tasks record attestation against that linked identity
instead of calling paid engagement APIs.
**Why:** It works on the free tier. The verifier boundary is intended to allow a
paid API implementation later without changing task callers.

## D010 — One reusable Task Verification Engine serves multiple products

**Status:** Accepted
**Decision:** Store reusable organization `TaskDefinition`s and per-user
`TaskCompletion`s, then attach them to raffles through `RaffleTask`. Campaigns
and points will reuse the engine in S3.
**Why:** Verification rules should be implemented once instead of separately
for raffles, campaigns, and future rewards.

## D011 — Member features should have Discord and web parity

**Status:** Accepted standing rule
**Decision:** A member capability should work in both Discord and the website
where technically possible, backed by the same database records and semantics.
Discord-native reaction gates may explicitly require Discord.
**Why:** KOS is no longer only a bot, and members should not be forced into one
surface for ordinary account, wallet, task, and raffle operations.

## D012 — Community pages are membership-public but session-gated

**Status:** Current implementation
**Decision:** `/c/:slug` does not require organization membership, but the
global middleware still requires a signed KOS session.
**Why:** This is how S2.5 shipped. If anonymous sharing is desired, middleware
and unauthenticated entry-panel behavior need an explicit product/security
decision.

## D013 — Deploy the dashboard and bot separately

**Status:** Accepted
**Decision:** Run the dashboard on Vercel, the bot on EC2 under PM2, and use one
managed PostgreSQL/Neon database. Generate proofs on bot-local storage and
deliver them to Discord.
**Why:** The dashboard benefits from serverless deployment while the Discord
gateway and scheduler require an always-on process.

## D014 — Phase 3 ships as additive staged releases

**Status:** Accepted
**Decision:** S1 accounts, S2 tasks/gating, S3 points/campaigns/store, and S4
role-weighted draws each use additive migrations and independently verified
deploys. Applied migrations are never rewritten.
**Why:** Small production releases reduce migration and rollback risk. S1, S2,
and the S2.5 parity follow-up are complete; S3/S4 remain future work.

## D015 — Billing remains scaffolded but hidden

**Status:** Accepted temporary decision
**Decision:** Keep subscription models and the billing page, but hide Billing
from the org sidebar until paid plans launch.
**Why:** This preserves future structure without presenting unavailable paid
functionality as active.

## D016 — Bot health is measured through a database heartbeat

**Status:** Accepted
**Decision:** The scheduler upserts `SystemStatus["bot-heartbeat"]` roughly
every minute; the admin health page treats a heartbeat under three minutes old
as online.
**Why:** It measures the deployed bot from Vercel without exposing or relying on
the obsolete localhost control channel.

## D017 — Points are an append-only ledger

**Status:** Accepted
**Decision:** Store point awards in `PointsLedger` and compute balances as
`SUM(delta)` per `(organizationId, userId)`. Task points use a unique
`sourceType/sourceId` so completing the same reusable task awards points only
once.
**Why:** A ledger is auditable, idempotent, and can support future manual
adjustments, campaigns, reward claims, and exports without mutating a fragile
balance column.

## D018 — Weighted raffle odds are snapshotted at entry

**Status:** Accepted
**Decision:** When a weighted raffle entry is recorded, store
`Participant.weight` as the highest configured multiplier among the entrant's
current Discord roles. Missing role weights default to `1×`.
**Why:** Draw odds must be reproducible from persisted data even if Discord
roles or org settings change before the raffle closes.

## D019 — Weighted draws use deterministic weighted sampling

**Status:** Accepted
**Decision:** Uniform raffles keep the existing HMAC ranking sampler. Weighted
raffles use a deterministic Efraimidis-Spirakis exponential race
(`-ln(U)/weight`, with `U` derived from HMAC(seed, userId)) to sample without
replacement.
**Why:** It gives proportional weighted odds while preserving verifiability and
avoiding visible duplicate entries.
