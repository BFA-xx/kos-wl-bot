# Discord Bot Setup

## 1. Create the application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. **New Application** → name it (e.g. `KOS Raffles`).
3. Copy the **Application ID** → this is `DISCORD_CLIENT_ID`.

## 2. Create the bot user

1. Sidebar → **Bot** → **Add Bot**.
2. **Reset Token** → copy it → this is `DISCORD_TOKEN`. Keep it secret.
3. Under **Privileged Gateway Intents**, enable:
   - ✅ **Server Members Intent** (required — role checks & server-join-age anti-alt)
   - ✅ **Message Content Intent** (required — Raid proof URL detection)

## 3. Invite the bot

Build an OAuth2 URL (Developer Portal → **OAuth2 → URL Generator**):

- **Scopes:** `bot`, `applications.commands`
- **Bot Permissions:**
  - View Channels
  - Send Messages
  - Embed Links
  - Attach Files
  - Read Message History
  - Mention Everyone _(only if you want winner pings to bypass suppression)_
  - Add Reactions
  - Manage Channels _(verification-only channel visibility)_
  - Manage Roles _(Raid reward roles)_
  - Create Public Threads
  - Send Messages in Threads
  - Manage Threads
  - Use Slash Commands

Example:

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=326686469200&scope=bot%20applications.commands
```

Open the URL and add the bot to your server.

## 4. Register slash commands

```bash
# Instant registration to one guild (recommended while testing):
#   set DISCORD_GUILD_ID in .env to your server id, then:
pnpm deploy:commands

# Production/global registration can take up to 1 hour to appear. Passing
# --global also mirrors a configured development guild so it cannot retain a
# stale guild-only command surface.
pnpm --filter @kos/bot deploy:commands -- --global
```

## 5. Grant manager access

Admins (Manage Server / Administrator) can use `/raffle` and `/blacklist`
immediately. Server administrators can grant a specific role the same runtime
access without editing the database:

```text
/config managers add role:@Collab Manager
```

The command definitions intentionally do not use Discord's default Manage
Server gate; authorization is checked at runtime so configured manager roles
can see and use the commands.

## 6. Channel setup

Create (or pick) channels for:

- the **raffle embed** (defaults to where you run `/raffle create`),
- **winner announcements** (`announce_channel`),
- **proof delivery** (`proof_channel`).
- **points and rewards activity**.
- **raid posts, proof threads, and staff summaries**.

Make sure the bot can **View / Send / Embed / Attach Files** where each channel
needs them.
Set the defaults with `/config channels`, then run `/config diagnose` for a
read-only readiness report covering channels, permissions, and the connected
web organization.

For member onboarding, run `/verification setup` or open **Settings → KOS
member verification** on `raffle.koslabs.app`. KOS can create the
**Unverified** role, but its bot role must remain above Unverified and every
role granted after verification. Choose the verification/rules/log channels,
select any extra Welcome channels that should remain visible, create codes,
then enable and publish the panel. Both control surfaces report missing role
hierarchy, channel, code, or permission requirements before launch.

## Troubleshooting

| Symptom                            | Fix                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Commands don't appear              | Run `pnpm deploy:commands`; for global, wait up to 1h, or set `DISCORD_GUILD_ID`.                                                    |
| "Used disallowed intents" on boot  | Enable **Server Members Intent** and **Message Content Intent** in the portal.                                                       |
| Buttons do nothing                 | Bot lacks Send/Embed permission in that channel.                                                                                     |
| Winner DMs not received            | The winner has DMs disabled; export wallets later via dashboard / `/raffle export`.                                                  |
| Raid role was not assigned         | Put the KOS bot role above the reward role and grant **Manage Roles**.                                                               |
| Raid thread was not created        | Grant Create/Send/Manage Threads in the configured raid channel.                                                                     |
| New members can see other channels | Grant **Manage Channels**, confirm the Unverified role, then press **Sync Access** in Discord or **Sync channel access** on the web. |
| Verification cannot grant a role   | Put the KOS bot role above Unverified, default roles, and every code-specific role.                                                  |

For staged rollout limits, verification milestones, and the onboarding smoke
test, see `docs/ROLLOUT.md`.
