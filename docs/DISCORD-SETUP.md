# Discord Bot Setup

## 1. Create the application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. **New Application** → name it (e.g. `KOS WL Bot`).
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
  - Mention Everyone *(only if you want winner pings to bypass suppression)*
  - Use Slash Commands

Example:

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=274877990912&scope=bot%20applications.commands
```

Open the URL and add the bot to your server.

## 4. Register slash commands

```bash
# Instant registration to one guild (recommended while testing):
#   set DISCORD_GUILD_ID in .env to your server id, then:
pnpm deploy:commands

# Global registration (omit DISCORD_GUILD_ID) can take up to 1 hour to appear.
```

## 5. Grant manager access

Admins (Manage Server / Administrator) can use `/raffle` and `/blacklist`
immediately. To allow specific roles, add their role IDs to the guild's
`managerRoleIds`:

- via the seed script: set `SEED_GUILD_ID` + `SEED_MANAGER_ROLE_IDS` and run
  `pnpm db:seed`, **or**
- via Prisma Studio (`pnpm db:studio`) → `guilds` → `managerRoleIds`.

## 6. Channel setup

Create (or pick) channels for:

- the **raffle embed** (defaults to where you run `/raffle create`),
- **winner announcements** (`announce_channel`),
- **proof delivery** (`proof_channel`).

Make sure the bot can **View / Send / Embed / Attach Files** in all three.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Commands don't appear | Run `pnpm deploy:commands`; for global, wait up to 1h, or set `DISCORD_GUILD_ID`. |
| "Used disallowed intents" on boot | Enable **Server Members Intent** in the portal. |
| Buttons do nothing | Bot lacks Send/Embed permission in that channel. |
| Winner DMs not received | The winner has DMs disabled; export wallets later via dashboard / `/raffle export`. |
