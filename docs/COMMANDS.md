# Command Reference

All admin commands require **Manage Server / Administrator**, or a configured
manager role. Responses are ephemeral (only the invoker sees them).

## `/raffle create`

Creates and posts a live raffle.

| Option                 | Required | Description                                                      |
| ---------------------- | -------- | ---------------------------------------------------------------- |
| `project`              | ✅       | Project name (shown as the embed author).                        |
| `title`                | ✅       | Raffle title.                                                    |
| `spots`                | ✅       | Number of WL spots (1–10000).                                    |
| `start`                | ✅       | `now`, a duration (`30m`, `2h`, `1d`), a unix time, or ISO date. |
| `end`                  | ✅       | Duration from start (`24h`, `2d`, `1w`) or absolute ISO date.    |
| `announce_channel`     | ✅       | Channel for the winner announcement.                             |
| `proof_channel`        | ✅       | Channel for the proof package.                                   |
| `role1`…`role5`        | —        | Eligible roles. Omit all = everyone may enter.                   |
| `match_mode`           | —        | `Any selected role` (default) or `Must have all`.                |
| `entry_channel`        | —        | Where to post the raffle (default: current channel).             |
| `banner`               | —        | Banner image attachment.                                         |
| `link`                 | —        | External link (makes the title clickable).                       |
| `wallet_chains`        | —        | `eth` (default), `sol`, `btc`, `eth_sol`, or `all`.              |
| `collect_wallets`      | —        | DM winners a wallet form (default `true`).                       |
| `min_account_age_days` | —        | Anti-alt: minimum Discord account age.                           |
| `min_server_age_days`  | —        | Anti-alt: minimum server membership age.                         |
| `min_messages`         | —        | Anti-alt: minimum messages (best-effort — see note).             |

> **Note on `min_messages`:** Discord's API does not expose per-member message
> counts. This requirement _flags_ accounts for review rather than hard-blocking,
> unless you wire in an activity provider. See `eligibilityService.ts`.

## `/raffle edit`

`id` (autocompletes) + any of: `title`, `spots`, `end`, `link`.
Editing the `end` of an already-ended raffle reopens it (status → LIVE).

## `/raffle delete`

Deletes the raffle and its live message. `id` autocompletes.

## `/raffle end`

Ends a raffle **now**, draws winners, announces, and ships proof. `id` autocompletes.

## `/raffle reroll`

| Option  | Description                           |
| ------- | ------------------------------------- |
| `id`    | Raffle (must be ENDED).               |
| `mode`  | `single`, `multiple`, or `all`.       |
| `user`  | The winner to replace (for `single`). |
| `count` | How many to replace (for `multiple`). |

Replaced winners are kept (marked `replaced`) for the audit trail; replacements
are drawn from entrants who didn't already win and aren't blacklisted. A reroll
re-announces and regenerates the proof package.

## `/raffle list`

Lists raffles, optionally filtered by `status` (Live / Upcoming / Ended).

## `/raffle stats`

Server-wide totals: raffles, live now, winners, entries, unique participants.

## `/raffle export`

| Option | Values                                              |
| ------ | --------------------------------------------------- |
| `id`   | Raffle ID (required)                                |
| `type` | `winners` (default, with wallets) \| `participants` |
| `as`   | `sheet` (default) \| `csv` — winners only           |

Winners come back as a link to a Google Sheet: anyone with the link can view
it, and the team's Google accounts can edit it. When the raffle is one half of
a GTD/FCFS pair, both halves are combined into one list with the GTD addresses
on top. An address that won both rounds is listed once, under GTD.

Opening a sheet that already exists never overwrites it, so edits the team made
there survive. Rewrite it from the current winners with **Rewrite sheet** on the
dashboard's raffle page — the bot's export always opens, never rewrites.

Set `as:csv`, or ask for `type:participants`, to get a CSV file instead. If
Google Sheets is not configured (see `GOOGLE_CLIENT_ID` and `BOT_API_TOKEN` in
`.env.example`), the winners export falls back to the CSV on its own.

## `/blacklist add | remove | list`

| Sub      | Options                     |
| -------- | --------------------------- |
| `add`    | `user` (required), `reason` |
| `remove` | `user` (required)           |
| `list`   | —                           |

Blacklisted users are blocked at entry time **and** excluded from draws/rerolls.

## `/config` (admins only)

| Sub               | Options                                 | Description                                                                  |
| ----------------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| `managers add`    | `role`                                  | Allow a role to use `/raffle` and `/blacklist`.                              |
| `managers remove` | `role`                                  | Revoke a manager role.                                                       |
| `managers list`   | —                                       | Show manager roles.                                                          |
| `channels`        | `raffle`, `announce`, `proof`, `points` | Set any default operational channels.                                        |
| `diagnose`        | —                                       | Check configured channels, bot permissions, and web organization connection. |
| `show`            | —                                       | Show current server config.                                                  |

Server owner and anyone with **Administrator / Manage Server** can always manage
raffles; `/config managers add` grants access to additional roles (mods, collab
managers) without touching the database.

## `/verification` (managers)

KOS member onboarding is configured entirely through private Discord
interactions. Members never type a verification code into a channel.

| Sub           | Options           | Description                                                                           |
| ------------- | ----------------- | ------------------------------------------------------------------------------------- |
| `setup`       | —                 | Open the interactive settings panel for flow, channels, roles, copy, and access sync. |
| `status`      | —                 | Show readiness checks without changing member access.                                 |
| `publish`     | —                 | Publish the welcome embed, or update the existing configured panel.                   |
| `code create` | —                 | Open a modal, then optionally attach code-specific roles with a role picker.          |
| `code edit`   | `code` (required) | Edit code, description, limit, expiration, status, reuse, and role grants.            |
| `code delete` | `code` (required) | Confirm deletion while preserving historical redemption and audit records.            |
| `code list`   | —                 | List status, uses, expiration, reuse policy, and role grants.                         |

The setup panel configures the Unverified role; verification, rules, log, and
extra onboarding channels; default verified roles; embed colour/copy; button
label/emoji; modal title/label/placeholder; code and rules requirements;
member code-reuse policy; success/failure messages; panel publication; and
channel access synchronization.

Enabling verification requires **Manage Roles** and **Manage Channels**, a
usable verification channel, a manageable Unverified role, and at least one
usable code when code verification is required. KOS grants default roles plus
the selected code's roles, removes Unverified, records rules acceptance, and
posts to the private log channel when configured.

## `/wallet` (everyone)

A reusable wallet registry — members register once and it's used for every raffle.

| Sub        | Options            | Description                                                                   |
| ---------- | ------------------ | ----------------------------------------------------------------------------- |
| `register` | —                  | Open the guided wallet registration flow.                                     |
| `set`      | `chain`, `address` | Save / update one wallet (Ethereum, Base, Robinhood Chain, Solana, Bitcoin).  |
| `view`     | —                  | See your saved wallets (private).                                             |
| `remove`   | `chain`            | Delete a saved wallet.                                                        |
| `panel`    | —                  | _(Manager)_ Post a public **Register / Update Wallet** button in the channel. |
| `export`   | —                  | _(Manager)_ Download a CSV of every registered wallet.                        |

When a member wins, the bot uses their **registered wallet automatically** — it
appears in the winner CSV and proof package, and the winner is only DM'd a form
if they have no wallet on file. Addresses are encrypted at rest.

## `/campaigns` (everyone)

Campaigns combine existing KOS tasks and raffle participation into one
time-bounded community journey. Responses are private.

| Sub        | Options               | Description                                      |
| ---------- | --------------------- | ------------------------------------------------ |
| `list`     | —                     | List live and scheduled campaigns in the server. |
| `join`     | `campaign` (required) | Join a live campaign.                            |
| `progress` | `campaign` (required) | Check required steps and completion status.      |

Task verification and raffle entry update campaign progress automatically.
Completing every required step during the live window awards the configured
campaign points once.

## Member buttons

- **Enter Raffle** — verifies eligibility + blacklist, prevents duplicates.
- **Leave** — removes the entry while the raffle is live.
- **Register / Update Wallet** (wallet panel) — opens a modal to save wallets for all chains at once.
- **Submit Wallet** (in winner DMs) — submit a wallet for that specific raffle.
- **Verify** — opens the configured private verification modal or advances directly to rules.
- **I Agree** — records rules acceptance and completes role assignment.
