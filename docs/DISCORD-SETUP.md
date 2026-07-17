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
   - Message Content Intent is **not** required.

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
  - Use Slash Commands

Example:

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=248832&scope=bot%20applications.commands
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

Make sure the bot can **View / Send / Embed / Attach Files** where each channel
needs them.
Set the defaults with `/config channels`, then run `/config diagnose` for a
read-only readiness report covering channels, permissions, and the connected
web organization.

## Troubleshooting

| Symptom                           | Fix                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| Commands don't appear             | Run `pnpm deploy:commands`; for global, wait up to 1h, or set `DISCORD_GUILD_ID`.   |
| "Used disallowed intents" on boot | Enable **Server Members Intent** in the portal.                                     |
| Buttons do nothing                | Bot lacks Send/Embed permission in that channel.                                    |
| Winner DMs not received           | The winner has DMs disabled; export wallets later via dashboard / `/raffle export`. |

For staged rollout limits, verification milestones, and the onboarding smoke
test, see `docs/ROLLOUT.md`.
