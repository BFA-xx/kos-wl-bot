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

## D012 — Community pages remain session-gated; raffle share pages are anonymous

**Status:** Superseded in part by D022
**Decision:** `/c/:slug` remains a signed-in community directory, while
`/r/:id` is the canonical anonymous, SEO-indexable raffle surface. Only
UPCOMING, LIVE, and ENDED raffles belonging to non-suspended organizations are
public. Entry APIs remain authenticated and return Discord OAuth users to the
same `/r/:id` page.
**Why:** Sharing should not require login, but private dashboard/admin data and
entry mutations must retain their existing authorization boundaries.

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
the S2.5 parity follow-up, the first S3 points/rewards slice, and the first S4
weighted-draw slice are complete; campaigns remain future work.

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

## D020 — Reward claims spend points through the ledger

**Status:** Accepted
**Decision:** Rewards are organization-owned catalog items. A redemption writes
a `RewardRedemption` row and a negative `PointsLedger` row with
`sourceType = REWARD_REDEEM`. Cancelled/rejected pending claims write a
positive `REWARD_REFUND` ledger row instead of mutating a balance.
**Why:** The existing points model stays append-only and auditable. It also
keeps web and Discord redemptions identical because both surfaces use the same
tables and ledger semantics.

## D021 — Points activity is hosted in a configured Discord channel

**Status:** Accepted
**Decision:** Each connected `Guild` can set `defaultPointsChannelId`. Web task
awards, Discord task awards, and reward redemptions post best-effort updates to
that channel when configured.
**Why:** Communities need one obvious place for earning/spending activity and
leaderboards, while still letting members use both web and Discord.

## D022 — Public raffle IDs are canonical and duplication is configuration-only

**Status:** Accepted
**Decision:** Use the existing stable raffle integer ID for `/r/:id` canonical
URLs instead of adding a slug migration. Duplicate actions load a reusable
configuration blueprint and create a new `DRAFT` raffle while explicitly
excluding participant, winner, proof, draw, message, counter, and analytics
state. Variant transforms (`SAME`, `GTD`, `FCFS`) are applied before creation.
**Why:** IDs already exist for every Discord- and web-created raffle, avoid
backfill/collision risk, and make every historical eligible raffle immediately
shareable. A configuration-only clone is safe and can later support templates,
cross-community targets, drafts, and schedules without copying outcome data.

## D023 — Raffle sharing and duplication preserve tenant ownership

**Status:** Accepted
**Decision:** `/r/:id` uses the globally unique raffle identity, then derives
the host organization exclusively through the raffle guild's unique
`GuildConnection`. Duplicate reads and writes must use both the source raffle
ID and the requesting organization's connected guild IDs. A duplicate remains
in its source guild; moving configuration across organizations requires a
separate, explicitly authorized future workflow.
**Why:** A globally shareable URL must not weaken dashboard isolation. Keeping
the tenant boundary in the server query prevents guessed IDs, modified request
bodies, or another organization's manager from reading or cloning private
configuration.

## D024 — Public raffle URL and lifecycle policy are code-level invariants

**Status:** Accepted
**Decision:** Raffle IDs are positive PostgreSQL `Int` identities. Only
UPCOMING, LIVE, and ENDED raffles are public; DRAFT and CANCELLED are not.
Share URLs use a normalized HTTP(S) `NEXT_PUBLIC_RAFFLE_ORIGIN`, falling back to
the production origin `https://raffle.koslabs.app`. The compatibility route
`/c/:slug/raffles/:id` verifies the slug and permanently redirects to `/r/:id`.
**Why:** These were already product expectations. Encoding and testing them
removes ambiguity and prevents route implementations from drifting apart.

## D025 — Member community membership comes from Discord OAuth

**Status:** Accepted
**Decision:** The member Communities tab separates communities whose connected
Discord guild appears in the signed-in user's `users/@me/guilds` response from
the complete non-suspended KOS directory. An organization with multiple guilds
is considered joined when any connected guild matches. If the stored Discord
token cannot be refreshed or the lookup fails, show a reconnect action instead
of treating the member as belonging to zero communities.
**Why:** Organization team membership and Discord community membership are
different concepts. Discord OAuth already grants the `guilds` scope and gives
the member an accurate, private list without additional paid APIs.

## D026 — Community X profiles are optional branding links

**Status:** Accepted
**Decision:** Store an optional normalized `Organization.xHandle`, editable
under Branding with `branding:edit`. Accept a handle or x.com/twitter.com
profile URL, store only the handle, and render canonical `x.com/:handle` links
on member cards, community pages, and public raffle host details.
**Why:** A first-class social link makes community identity clearer while
remaining separate from paid X engagement verification and OAuth-linked member
accounts.

## D027 — Authenticated visual tests use normal signed sessions

**Status:** Accepted
**Decision:** Playwright visual regression tests create a short-lived normal
`kos_session` cookie from externally supplied test credentials, or consume an
externally supplied storage-state file. Generated authentication state,
reports, traces, and failure output are gitignored; no application test-login
route or authentication bypass is allowed. Desktop and mobile projects run
serially because both use one Discord identity and Discord enforces a per-user
REST rate-limit bucket.
**Why:** Member and organization pages need real authenticated browser coverage,
but production authentication must not be weakened for testing. Serial visual
projects make screenshot comparison deterministic without pretending to be a
load test.

## D028 — Member activity remains tenant- and permission-scoped

**Status:** Accepted
**Decision:** Team members with `participant:view` can open a participant ID to
see that user's organization-specific raffle entries, wins, task verification,
points, and reward activity. The route resolves a user only after proving
activity owned by the current organization. Guild-backed records use the
organization's connected guild IDs and native records use `organizationId`.
Wallet registration status additionally requires `wallet:view`; addresses stay
on the Wallets page.
**Why:** A consolidated member view makes moderation and community management
faster without turning a global Discord identity into a cross-tenant data leak
or weakening the existing wallet permission boundary.

## D029 — Private entry counts are omitted from completion artifacts

**Status:** Accepted
**Decision:** When `Raffle.hideEntries` is enabled, omit the entry count from
the winner announcement, proof Discord embed, PNG winner card, and PDF report.
Do not render a `Private` label, dash, empty chip, or other placeholder.
**Why:** Entry visibility is a raffle-level privacy choice and should remain
consistent after the raffle closes. Omitting the field is clearer and avoids
revealing information the community chose to hide.

## D030 — Member raffle history is readable but not actionable

**Status:** Accepted
**Decision:** `/me/raffles` returns live raffles separately from the 30 most
recent ENDED raffles across non-suspended KOS communities. Ended cards preserve
historical task labels and the member's completion state, but task buttons and
entry controls are disabled. Focused ended views explicitly show `Raffle ended`
and link to the canonical public result page.
**Why:** Members need to review past requirements and results without mistaking
an ended campaign for something they can still complete or enter.

## D031 — Dashboard raffle deletion is bot-mediated

**Status:** Accepted
**Decision:** A team member with `raffle:delete` can request permanent deletion
from dashboard raffle menus. The dashboard atomically cancels the raffle and
writes a `RAFFLE_DELETE_REQUEST` guild log. The scheduler consumes the request,
removes the shared Discord post, removes bot-local proof files, records a guild
audit event, and deletes the raffle and its cascading records. Duplicate
requests are idempotent.
**Why:** Vercel cannot clean EC2-local proof artifacts and should not bypass the
bot's ownership of Discord side effects. Immediate cancellation closes entry
and draw races while the bot completes destructive cleanup on its next tick.

## D032 — Collab Hub is organization-native and links existing raffle data

**Status:** Accepted
**Decision:** Store collaboration/partner/CRM records under `organizationId`.
Attach an existing raffle through a unique `CollaborationRaffle` link only
after validating its guild belongs to the same organization. Do not copy
participants, winners, proofs, or raffle lifecycle state into the CRM.
**Why:** The organization is the CRM tenant, while raffles already have a
trusted guild ownership anchor and remain the source of truth for execution.
Linking avoids drift and preserves multi-tenant isolation.

## D033 — Collaboration wallet tracking does not duplicate addresses

**Status:** Accepted
**Decision:** `CollaborationWallet` stores a winner/user reference, detected
chain, and workflow status only. CSV/XLSX/TXT exports resolve and decrypt the
existing `Winner.wallet` or `WalletProfile` under `collab:export`, then mark
the submission state.
**Why:** Copying encrypted or plaintext wallet addresses into a second model
would create conflicting registries, expand sensitive-data exposure, and make
member wallet updates invisible to the collaboration workflow.

## D034 — Collab Hub automations run in the existing bot scheduler

**Status:** Accepted
**Decision:** Reconcile attached raffle outcomes and wallet progress after a
draw and in a throttled one-minute scheduler sweep. The same sweep creates
inactive reminders and fans due reminders into existing in-app notifications.
Manual pipeline movement stays available.
**Why:** Raffle completion and reliable background reminders require the
always-on runtime. PostgreSQL remains the dashboard/bot coordination boundary,
consistent with D004 and D005.

## D035 — Collab Hub has independent granular permissions

**Status:** Accepted
**Decision:** Use `collab:view`, `collab:create`, `collab:edit`,
`collab:assign`, `collab:export`, and `collab:archive`. The additive migration
grants these to the appropriate existing system roles but does not mutate
custom roles.
**Why:** Relationship notes, assignments, files, and plaintext export responses
have different risk profiles. Separate permissions let organizations delegate
daily collaboration work without granting wallet export or destructive access.

## D036 — Collaboration files are private and application-gated

**Status:** Accepted
**Decision:** Upload CRM attachments directly to private Vercel Blob objects
using short-lived path-restricted tokens. Never return raw Blob URLs from the
collaboration detail API. Stream reads through a route that rechecks
`collab:view`; require `collab:edit` for upload registration and deletion.
**Why:** Agreements, wallet lists, and partner documents are organization data,
not public branding assets. Application-gated streaming preserves the existing
role system and supports 15 MB files without exceeding Vercel request limits.

## D037 — Proof artifacts have encrypted portable copies

**Status:** Accepted
**Decision:** Keep EC2-local proof paths for bot cleanup and Discord delivery,
and also store base64/AES-256-GCM encrypted PDF/CSV/PNG copies in nullable
`Proof` byte columns. Serve them only through tenant-scoped Collab Hub routes;
winner CSV downloads require `collab:export`. Backfill legacy local artifacts
in bounded scheduler batches.
**Why:** Vercel cannot access bot-local files, while Discord links alone are not
a durable application storage boundary. Encrypted copies make proof access
portable without adding a new shared infrastructure secret to EC2.

## D038 — Manual wallet import reconciles member-owned wallet profiles

**Status:** Accepted
**Decision:** CSV/TXT wallet imports may create collaboration workflow rows only
when the Discord ID and normalized address match an existing encrypted
`WalletProfile`. Never create or overwrite a member wallet from an organization
import, and never copy the address into a collaboration model or audit record.
**Why:** Teams need a fast reconciliation workflow, but organization staff must
not silently replace member-owned payout identities or create a second wallet
source of truth.
