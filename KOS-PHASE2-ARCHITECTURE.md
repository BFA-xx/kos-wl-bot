# KOS Phase 2 — Multi-Tenant Platform Architecture

KOS is now an **Alphabot-style SaaS**: many Discord communities each get their own
branded space (a vanity slug/URL) that connects one or more Discord servers,
manages its own campaigns, and sees **only its own data**. KOS staff get a
separate internal Super Admin console.

This phase is **additive and backward-compatible**: the existing Discord bot is
unchanged and keeps running against the same database.

---

## 1. Tenancy model

```
User (Discord identity)
  └─ OrganizationMember ─┬─ Organization ──┬─ GuildConnection ─→ Guild (Discord server) ─→ Raffles, Participants, Winners, Wallets, Blacklist
                         │  (owner, roles) │
                         └─ OrganizationRole (permissions)   Subscription (FREE/…)   AuditLog
```

- An **Organization** is a community/tenant. It has a unique `slug` used in the
  URL (`/[slug]/...`), an owner, branding, a subscription, roles and members.
- A **GuildConnection** links a Discord server to an org. `guildId` is
  **globally unique** — a server belongs to at most one org. This is the
  isolation anchor.
- **Isolation rule:** an org's data = rows whose guild is one of its connected
  guilds. Every query is filtered by the org's `guildIds`. No raw client id is
  ever trusted.

### Why the bot needs no changes
The bot still reads/writes `Guild`, `Raffle`, `Participant`, etc. keyed by
`guildId`. The dashboard resolves `Guild → GuildConnection → Organization` at
read time, so multi-tenancy is enforced entirely in the dashboard. New tables
and columns are additive/nullable, so the bot's writes keep working.

---

## 2. Roles & permissions

Defined in `apps/dashboard/lib/permissions.ts` (pure, dependency-free).

Built-in roles seeded for every org:

| Role | Permissions |
|---|---|
| **Owner** | everything (also short-circuited by `Organization.ownerId`) |
| **Admin** | everything except `org:transfer`, `org:delete` |
| **Moderator** | raffle create/edit/reroll/end, participant/analytics/report view, wallet:view |
| **Collab Manager** | raffle create/edit, participant/analytics/report view |
| **Viewer** | all `*:view` |

Permission strings: `raffle:create|edit|delete|reroll|end`, `participant:view`,
`wallet:view|export`, `analytics:view`, `report:view|export`, `member:manage`,
`branding:edit`, `settings:edit`, `billing:manage`, `guild:connect`,
`org:transfer`, `org:delete`.

---

## 3. Authentication

- **Discord OAuth2 only** (password login removed). Scopes:
  `identify email guilds guilds.members.read`.
- On login the user is upserted with avatar, email, and **encrypted** access +
  refresh tokens (AES-256-GCM, `WALLET_ENCRYPTION_KEY`) + expiry.
- `getValidAccessToken(userId)` refreshes an expired token via the stored
  refresh token and persists the rotated pair.
- Session is an HMAC-signed cookie (`DASHBOARD_SESSION_TOKEN`); the Edge
  middleware gates every route.
- **Super admin**: any Discord id in `SUPER_ADMIN_DISCORD_IDS` gets
  `User.isSuperAdmin = true` on login. Community owners can never reach `/admin`.

### The authorization choke-point — `lib/access.ts`
- `requireOrgAccess(slug, permission?)` → `{ user, org, member, isOwner, permissions, guildIds }` or throws `AccessError` (401/403/404). Owner short-circuits all permissions.
- `requireSuperAdmin()` → super-admin or 403.
- `guildScope(guildIds)` / `raffleGuildScope(guildIds)` — the Prisma `where`
  fragments every org query MUST use.
- `logAudit(...)` writes an org-scoped `AuditLog`.

Every `/api/[org]/*` route calls `requireOrgAccess`; every `/api/admin/*` route
calls `requireSuperAdmin`.

---

## 4. Discord server linking (Alphabot-style)

Settings → "Discord servers":
1. `GET /api/[org]/guilds` lists servers where the user is owner/`MANAGE_GUILD`
   (via their OAuth token).
2. Click **Connect** → if the bot isn't in the server, the KOS bot invite opens
   (`guild_id` preselected).
3. Server verifies (a) the user manages the guild and (b) the bot is present
   (bot-token `GET /guilds/{id}`), then records a `GuildConnection`.
4. The bot's existing `GuildCreate` handler already upserts the `Guild` row, so
   "the bot auto-registers the server" needs no bot change.

---

## 5. Routes

```
/login                     Discord login
/                          router → onboarding or /[slug]/dashboard
/onboarding                create organization
/invite/[token]            accept a team invite
/[slug]/                    org space: dashboard, campaigns, raffles, participants,
                           wallets, analytics, reports, settings, team, billing, support
/admin/                    Super Admin: organizations, users, subscriptions, revenue,
                           health, logs, flags, announcements
```

---

## 6. Environment variables (new / changed)

| Var | Purpose |
|---|---|
| `SUPER_ADMIN_DISCORD_IDS` | comma-separated Discord ids granted Super Admin |
| `DISCORD_BOT_TOKEN` | bot token used server-side to verify bot presence in a guild |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | OAuth app (redirect: `<DASHBOARD_URL>/api/auth/discord/callback`) |
| `DASHBOARD_SESSION_TOKEN` | HMAC session signing secret |
| `WALLET_ENCRYPTION_KEY` | AES key (shared with bot) — now also encrypts OAuth tokens |
| `DASHBOARD_URL` | public base URL |
| _removed_ | `DASHBOARD_PASSWORD`, `DASHBOARD_ALLOWED_USER_IDS`, `DISCORD_GUILD_ID` gate |

Discord Developer Portal → add the OAuth **redirect URL** and enable the
`identify email guilds guilds.members.read` scopes.

---

## 7. Database migration

Additive migration `packages/db/prisma/migrations/*_phase2_multitenant`:
9 new tables (organizations, organization_members, organization_roles,
organization_invites, guild_connections, subscriptions, audit_logs,
feature_flags, announcements) + 4 enums + nullable columns on `users`. No
destructive statements — the running bot is unaffected.

Data migration `packages/db/scripts/migrate-to-orgs.ts` (idempotent): creates the
**KOS** org owned by the first `SUPER_ADMIN_DISCORD_IDS`, seeds roles + FREE
subscription + owner membership, and connects **every existing guild** to it so
no legacy raffle is orphaned.

```bash
# TEST database only during development:
DATABASE_URL=<test> pnpm --filter @kos/db migrate            # apply schema
MIGRATION_OWNER_ID=<discordId> DATABASE_URL=<test> pnpm --filter @kos/db migrate:orgs
```

---

## 8. Release checklist (production — run only when ready)

1. **Back up** the production Neon database.
2. `DATABASE_URL=<prod> pnpm --filter @kos/db migrate:deploy` — applies the
   additive migration (the un-updated bot keeps running).
3. `MIGRATION_OWNER_ID=<your-discord-id> DATABASE_URL=<prod> pnpm --filter @kos/db migrate:orgs`.
4. In the Discord Developer Portal: add the OAuth redirect URL + scopes.
5. Set new env vars on Vercel (`SUPER_ADMIN_DISCORD_IDS`, `DISCORD_BOT_TOKEN`).
6. Deploy the dashboard to Vercel.
7. Verify: log in with Discord → land on `/kos/dashboard` → all legacy raffles
   present → connect a server → super-admin sees `/admin`.
8. The **bot on EC2 needs no redeploy**.

---

## 9. Out of scope (future modules)
Real payments (Stripe), Campaigns/Social-Verification/Reputation/API modules
(nav placeholders today), and denormalizing `organizationId` onto bot tables
(an optional later optimization that would require a small bot change).
