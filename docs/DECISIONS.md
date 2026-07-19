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

**Status:** Superseded in path format by D049
**Decision:** `/c/:slug` remains a signed-in community directory, while
`/r/:reference` is the canonical anonymous, SEO-indexable raffle surface. Only
UPCOMING, LIVE, and ENDED raffles belonging to non-suspended organizations are
public. Entry APIs remain authenticated and return Discord OAuth users to the
same canonical raffle page.
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
the S2.5 parity follow-up, the first S3 points/rewards and campaigns slices,
and the first S4 weighted-draw slice are complete in the application. Campaigns
still require production migration and runtime deployment.

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

**Status:** Superseded in URL format by D049
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
**Decision:** The public route resolves the globally unique raffle identity,
then derives
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
`/c/:slug/raffles/:id` verifies the slug and permanently redirects to the
branded canonical route defined by D049.
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

## D039 — Historical raffle bootstrap links and groups source records

**Status:** Accepted
**Decision:** Bootstrap Collab Hub from an organization's unlinked ENDED
raffles that have entries. Exclude cancelled, empty, and test records; group
repeat rounds by normalized project name or a narrowly shared X task identity;
attach every original raffle to one completed collaboration. Infer an unlabeled
same-project round as GTD only when it is paired with explicit FCFS. Do not copy
participants, winners, proofs, or wallet addresses.
**Why:** Existing raffle history already contains the useful partner, social,
allocation, winner, and date signals. Linking preserves those source tables and
tenant boundaries while giving teams a useful CRM immediately; the narrow
social heuristic avoids merging unrelated raffles that mention the community's
own X account.

## D040 — Collaboration team assignment and media stay explicit

**Status:** Accepted
**Decision:** Present the legacy `Collaboration.ownerId` field as Hosted by and
only allow active organization members in collaboration assignment controls.
Historical imports assign the attached raffle's `createdById`; grouped rounds
use the most frequent host, then the most recent host as a deterministic
tiebreaker. Do not infer a partner logo or generic category from an attached
raffle banner; render raffle media separately in responsive fixed-height frames
with `object-cover` and a branded error fallback.
**Why:** Organization ownership and import execution are authorization
concepts, not proof of who hosted a raffle. The raffle creator is the durable
source for host attribution. Raffle banners are campaign assets rather than
partner identity, and Discord interaction attachment URLs expire, so promoting
them to logos creates repeated labels, cropped images, and broken project
branding.

## D041 — Discord raffle banners become durable before publication

**Status:** Accepted
**Decision:** When a raffle uses a Discord attachment banner, download and
validate the image before publishing, store its bytes in the one-to-one
`RaffleBannerAsset`, and replace `Raffle.bannerUrl` with the versioned public
`/r/:id/banner` route. Restrict ingestion to Discord attachment hosts,
supported image MIME types, a 5 MB streamed limit, and a bounded timeout.
Build the stored route from the stable `PUBLIC_RAFFLE_ORIGIN`, never from the
dashboard control URL or a deployment-specific hostname. Canonical rendering
may rewrite legacy `/r/:id/banner` records onto that public origin.
Dashboard Vercel Blob uploads remain unchanged.
**Why:** Discord interaction attachment URLs expire. Persisting before the
Discord post makes every new banner portable across EC2 and Vercel while
preventing untrusted proxying or unbounded database writes.

## D042 — Wallet chains are explicit shared registry identities

**Status:** Accepted
**Decision:** Store Robinhood Chain as the distinct `ROBINHOOD` `WalletChain`
value and present it as `Robinhood Chain (RH)` in web and Discord. Validate it
as an EVM `0x` address, but do not treat an Ethereum or Base profile as an RH
profile. Team raffle selection, member registration, entry eligibility,
winner collection, exports, and duplication all use the same enum-backed
identity.
**Why:** The same address format does not mean the same payout network. An
explicit chain prevents ambiguous winner exports and keeps Discord/web entry
rules identical without introducing paid or on-chain verification.

## D043 — Hosted raffle configuration drives Collab Hub chain labels

**Status:** Accepted
**Decision:** Derive the chain displayed by a collaboration from the stable,
deduplicated union of `walletChains` on all attached raffles. Apply the shared
wallet-chain labels, including `Robinhood Chain (RH)`, in Hub cards, tables,
details, partner summaries, and CSV exports. Use `CollaborationPartner.chain`
only when no attached raffle provides chain data.
**Why:** Teams already select the operational wallet networks while creating a
raffle. Requiring the same data on the partner record creates drift and left
historical Hub rows blank even though the linked raffle retained the answer.

## D044 — Canonical public raffle pages own an always-dark document boundary

**Status:** Accepted
**Decision:** Scope dark design tokens and `color-scheme: dark` on every public
raffle reference, regardless of the stored member/dashboard theme preference.
Keep the HTML/body overscroll canvas dark when that page is present and use
dynamic viewport height for its root. When the public page client-navigates
into the app, carry
the document's dark class into the destination so the scoped public wrapper
cannot reveal a stale light dashboard. Preserve the existing theme toggle on
authenticated dashboard surfaces and do not overwrite its saved preference.
**Why:** The share page intentionally uses a dark branded hero while some
lower cards use shared theme variables. Allowing `kos-theme=light` to reach
only those cards creates a mixed-contrast split, and a light document canvas
becomes a long white tail during mobile overscroll. The page-local boundary
keeps the public experience deterministic without removing theme functionality
elsewhere.

## D045 — Production slash commands register globally

**Status:** Accepted
**Decision:** Production deploys pass `--global` when registering slash
commands. If `DISCORD_GUILD_ID` is still configured for development
compatibility, write the same command definitions to that guild as well.
Development deploys without `--global` may continue using instant guild
registration.
**Why:** A production environment can retain a development guild ID, which
previously prevented every other installed server from receiving new command
definitions. Mirroring avoids a stale guild override while global commands
propagate.

## D046 — One scheduler uses bounded work and atomic outcome claims

**Status:** Accepted for controlled beta
**Decision:** Keep the existing one-process sweep scheduler, bound every queue
and lifecycle query by `SCHEDULER_BATCH_SIZE`, and continue full batches on the
next tick. A draw must atomically claim its current raffle status inside the
winner transaction; rerolls must atomically claim each active winner before a
replacement is inserted.
**Why:** Batches prevent one busy category from making a tick unbounded, while
database claims prevent duplicate outcomes from concurrent dashboard, command,
or scheduler requests. Distributed scheduling and gateway sharding remain
required before large-scale multi-process operation.

## D047 — Authenticated visual CI is protected production testing

**Status:** Accepted
**Decision:** Run committed desktop/mobile baselines against production using a
dedicated ordinary KOS user, short-lived signed session state, and a GitHub
environment with required review. Skip fork pull requests and upload only
failure reports, screenshots, traces, and diffs—not authentication state.
**Why:** The member and tenant surfaces need real authenticated regression
coverage, but production session-signing material must never be available to
untrusted pull-request code or committed browser state.

## D048 — Raffle wallet chains are a strict payout boundary

**Status:** Accepted
**Decision:** Resolve winner wallets only from a raffle-specific submission
whose chain is configured on the raffle, or a reusable profile matching one of
those configured chains. Reject raffle-specific submissions for any other
chain. Apply the same resolver to Discord proof output, dashboard wallet lists,
CSV/XLSX exports, historical imports, and Collab Hub reconciliation. If no
matching wallet exists, report the wallet as missing and return the workflow to
Waiting instead of preserving a mislabeled chain.
**Why:** EVM and non-EVM profiles coexist on one member account. Falling back to
the first saved profile made a Robinhood raffle appear to have a Solana payout
address, even though the raffle configuration was correct. Missing data is
safer and more actionable than exporting a wallet for the wrong network.

## D049 — Public raffle links are branded and collision-safe

**Status:** Accepted
**Decision:** Generate canonical public paths as
`/r/:community-x-:project-:id`, using normalized organization and project names
for readability and the immutable global raffle ID as the final uniqueness
key. Numeric `/r/:id`, legacy `/c/:slug/raffles/:id`, and stale branded names
must permanently redirect to the current canonical path. Do not add a mutable
or separately persisted slug column. Internal durable banner assets remain on
the numeric `/r/:id/banner` route.
**Why:** A share link should identify the host and project before it is opened,
while recurring project names and renamed communities must never collide or
break historical links. The trailing ID preserves stable resolution without a
schema migration; canonical redirects keep the visible URL current.

## D050 — Campaigns compose existing task, raffle, and points primitives

**Status:** Accepted; implemented locally, not yet deployed
**Decision:** Model a campaign as an organization-owned lifecycle record with
ordered links to existing `TaskDefinition` and `Raffle` records plus one unique
member enrollment. Members explicitly join. Completion is derived from verified
task completions and raffle participation, then persisted once on the
enrollment and optionally awarded once through `PointsLedger` source type
`CAMPAIGN_COMPLETE`. Ship manager and member web surfaces together with the
Discord `/campaigns` command, and let the existing bot scheduler own timed
status transitions.
**Why:** Task verification, raffle entry, scheduling, and points already have
audited sources of truth. Composing them avoids parallel campaign-only evidence
or balance systems and preserves Discord/web parity and idempotency.
