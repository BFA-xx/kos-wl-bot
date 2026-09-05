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
   - ✅ _Successfully entered the raffle._
   - _You are already participating._
   - ⛔ _You do not meet the requirements_ (it lists what you're missing).

Click **Leave** any time before it ends to withdraw.

### If you win

The bot announces winners and pings you. If you already registered a wallet,
you're done. If not, you'll get a DM with a **Submit Wallet** button.

### Join a campaign

Campaigns group community tasks and raffle entries into one progress track.

- On Discord, use `/campaigns list`, `/campaigns join`, and
  `/campaigns progress`.
- On the website, open **Campaigns** in your member area.
- Complete each required task or raffle step through its normal KOS flow.
- When all required steps are complete while the campaign is live, KOS marks
  the campaign complete and awards its completion points once.

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

### Run a campaign

Open **Campaigns** in the organization dashboard. Create a draft, choose the
existing tasks and raffles members must complete, set the dates and completion
points, then publish. Future-dated campaigns schedule automatically; live
campaigns can be ended or cancelled from the same workspace.

### Manage raffles

| Need                    | Command                                            |
| ----------------------- | -------------------------------------------------- |
| Edit a raffle           | `/raffle edit id:<#>`                              |
| End early & draw now    | `/raffle end id:<#>`                               |
| Reroll winners          | `/raffle reroll id:<#> mode:single\|multiple\|all` |
| List raffles            | `/raffle list`                                     |
| Stats                   | `/raffle stats`                                    |
| Export entrants/winners | `/raffle export id:<#>`                            |
| Delete                  | `/raffle delete id:<#>`                            |

### Get members' wallets

- **Automatic:** when a raffle ends, each winner's registered wallet is included
  in the winner CSV + proof package sent to your proof channel.
- **Whole registry:** `/wallet export` (CSV of every member's saved wallets).
- **Dashboard:** the **Wallets** page → _Download CSV_.

### Hand the winners to a partner

**Open in Google Sheets** on a raffle's page (or `/raffle export` in Discord)
opens the winning addresses as a shared, editable spreadsheet instead of
downloading a file.

- **GTD and FCFS arrive as one list**, GTD addresses on top and FCFS below. A
  raffle linked to a collaboration uses that grouping; otherwise the two halves
  are matched by project name. An address that won both rounds is listed once,
  under GTD, so the partner does not spend two spots on one wallet.
- **Two tabs:** _Winners_ (numbered list — GTD/FCFS, chain, address) and
  _Addresses_ (just the addresses in the same order, to copy out).
- **Nothing internal is in it.** No Discord usernames, and no sign of which
  addresses came from the team pool or whose wallets they are — the sheet is
  readable by anyone holding the link, and a "Team Pool" column there would
  tell the partner which of their spots you took. That detail stays in
  _Winners + Wallets (Excel)_, which downloads rather than shares.
- **Who can do what:** anyone with the link can view; the Google accounts listed
  in _Settings → Google Sheets_ can edit. Treat the link as the key — it opens
  the winners' wallet addresses to anyone who has it.
- **Editing is safe.** Opening the sheet again never rewrites it. After a reroll
  or a team-wallet fill the raffle page shows a warning with a **Rewrite sheet**
  button — that one _does_ replace whatever the team edited.

An admin connects the Google account once in **Settings → Google Sheets**.
Sheets are created in that account's Drive, so the org keeps them if the
integration is later disconnected.

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
