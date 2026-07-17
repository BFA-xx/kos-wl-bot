# KOS Raffles — User Guide

A quick guide you can share with your community and team.

---

## For members

### Register your wallet (do this once)

You can save your wallets so you never have to paste them again when you win.

- **Easiest:** find the **Wallet Registration** panel a mod posted and click
  **Register / Update Wallet**. Fill in the chains you use (Ethereum, Base,
  Solana, Bitcoin) and submit.
- **Or use the command:** `/wallet set` → pick a chain → paste your address.

Other commands:
- `/wallet view` — see what you've saved (only you can see it).
- `/wallet remove` — delete a saved wallet.

You can update your addresses any time — just run `/wallet set` again or reopen
the panel. Your saved wallet is used automatically if you win, so you won't be
asked to paste it again.

### Enter a raffle

1. Open the raffle post.
2. Click **Enter Raffle**.
3. You'll get one of:
   - ✅ *Successfully entered the raffle.*
   - *You are already participating.*
   - ⛔ *You do not meet the requirements* (it lists what you're missing).

Click **Leave** any time before it ends to withdraw.

### If you win

The bot announces winners and pings you. If you already registered a wallet,
you're done. If not, you'll get a DM with a **Submit Wallet** button.

---

## For managers / collab managers

### Getting access

- Server owner, **Administrator**, and **Manage Server** can manage raffles out
  of the box.
- To let a specific role (mods, collab team) manage raffles:
  `/config managers add role:@YourModRole`
- Check current setup: `/config show`

### Run a raffle

```
/raffle create
  project: ProjectX
  title: KOS x ProjectX WL
  spots: 5
  start: now
  end: 24h
  announce_channel: #winners
  proof_channel: #proof
  role1: @OG Holder
  role2: @Active Member
  match_mode: Any selected role can enter
```

- `start` / `end` accept `now`, `30m`, `2h`, `24h`, `2d`, `1w`, or an exact date.
- Add up to 5 eligible roles; `match_mode` controls **any** vs **all**.
- Optional anti-alt: `min_account_age_days`, `min_server_age_days`.

The bot posts a live embed (with countdown + Enter/Leave), opens and closes on
schedule automatically, draws winners, announces them, and delivers a **proof
package** (PDF + winner CSV + winner card) to your proof channel.

### Manage raffles

| Need | Command |
| --- | --- |
| Edit a raffle | `/raffle edit id:<#>` |
| End early & draw now | `/raffle end id:<#>` |
| Reroll winners | `/raffle reroll id:<#> mode:single\|multiple\|all` |
| List raffles | `/raffle list` |
| Stats | `/raffle stats` |
| Export entrants/winners | `/raffle export id:<#>` |
| Delete | `/raffle delete id:<#>` |

### Get members' wallets

- **Automatic:** when a raffle ends, each winner's registered wallet is included
  in the winner CSV + proof package sent to your proof channel.
- **Whole registry:** `/wallet export` (CSV of every member's saved wallets).
- **Dashboard:** the **Wallets** page → *Download CSV*.

### Anti-farming

- `/blacklist add user:@someone reason:...` — block an account.
- `/blacklist remove` / `/blacklist list`.
- Blacklisted users can't enter and are excluded from draws/rerolls.

### Post the wallet panel

`/wallet panel` posts a public button members can click to register/update
their wallets. Pin it in an onboarding or #wallets channel.

---

## The dashboard

At your dashboard URL (default `http://localhost:3001` in dev):
- **Overview** — live raffles + stats (auto-refreshing).
- **Raffles** — every raffle; open one to view winners, export CSV, end, or reroll.
- **Wallets** — registry stats + CSV download.
- **Blacklist** — add/remove blocked users.

Sign in with the dashboard password your admin set.
