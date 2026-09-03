# X (Twitter) Task Verification Setup

How to connect a real X API key so raffle and campaign tasks are verified
against X instead of taken on trust.

## What actually gets verified

| Task | How it is checked | What it costs |
| --- | --- | --- |
| `X_FOLLOW` | Authenticates as the member and reads the target account's `connection_status` | 1 user read ($0.010) per target, **deduplicated per 24h UTC day** |
| `X_LIKE` | Sweeps the post's liker list once, caches it, answers every member from cache | 1 post read + up to `X_SWEEP_MAX_PAGES` × 100 reads, per post per TTL |
| `X_REPOST` | Same sweep against the reposter list | as above |
| `X_COMMENT` | Not checked — link + attest | free |
| `DISCORD_JOIN` / `DISCORD_ROLE` | Already real, via the bot token | free |

Everything requires the member to have linked their X account first (`/me` →
Connect X). Linking is what proves the identity; verification proves the action.

Why likes and reposts are swept rather than checked per member: X has no "did
this user like it" endpoint. The only way to know is to read who engaged with
the post, so the cost belongs to the post, not to the crowd. See D056 in
[DECISIONS.md](DECISIONS.md).

## 1. Create the X app

1. Go to the [X Developer Portal](https://developer.x.com/en/portal/dashboard)
   and create a Project + App.
2. **User authentication settings** → Set up:
   - **App permissions:** Read
   - **Type of App:** Web App, Automated App or Bot (a *confidential* client —
     this is what lets the app hold a client secret)
   - **Callback URI / Redirect URL:** `<DASHBOARD_URL>/api/connect/x/callback`
     (locally `http://localhost:3001/api/connect/x/callback`)
   - **Website URL:** your dashboard URL
3. **Keys and tokens** → copy:
   - **OAuth 2.0 Client ID** → `X_CLIENT_ID`
   - **OAuth 2.0 Client Secret** → `X_CLIENT_SECRET`
   - **Bearer Token** → `X_BEARER_TOKEN` (only needed for like/repost sweeps)

The app requests `users.read tweet.read follows.read offline.access`. Members
who linked X before this change already granted these, so nobody has to re-link.

## 2. Buy credits and set a spending limit

X retired its free tier in February 2026. Everything below spends real money.

1. Developer Console → purchase credits.
2. **Set a Spending limit** for the billing cycle. Do this before enabling
   anything. It is enforced by X, unlike the app-level budget, so it is the
   backstop that actually cannot be exceeded.
3. If you turn on **auto-recharge**, the spending limit is the only thing
   between a runaway loop and your card. It tops up at most once per 5 minutes.

## 3. Set the environment variables

These go in the **root `.env`** (the bot and the dashboard both read it on EC2)
**and** in **Vercel** for the dashboard. Both apps need the credentials — the
bot refreshes member tokens itself.

```bash
X_CLIENT_ID="..."
X_CLIENT_SECRET="..."

# off | follow_only | full
X_VERIFY_MODE="off"

# Monthly ceiling on billable reads. 1 follow check = 1 read = $0.010.
X_VERIFY_MONTHLY_READ_BUDGET="0"

# Only needed for X_VERIFY_MODE=full
X_BEARER_TOKEN=""
X_SWEEP_MAX_PAGES="20"
X_SWEEP_TTL_MINUTES="10"
```

Both `X_VERIFY_MODE` and a non-zero `X_VERIFY_MONTHLY_READ_BUDGET` must be set
before anything is checked for real. Either one left at its default keeps every
X task on link + attest.

## 4. Run the migrations

```bash
cd packages/db && npx prisma migrate deploy
```

Adds `x_verify_budget` (the spend ledger) and `x_engagement_sweeps` /
`x_engagement_actors` (the cached engager sets).

## 5. Turn it on, in stages

Roll forward one step at a time and watch `/admin/health` between steps.

1. **`off`** — deploy with credentials in place but verification disabled.
   Confirm members can still link X and complete tasks.
2. **`follow_only`** with a small budget (say `500` ≈ $5 ceiling). Do a real
   follow task yourself: follow the target, verify, and confirm it passes;
   then unfollow, re-verify with a second account, and confirm it holds at
   *Pending* rather than passing.
3. **`full`** — add `X_BEARER_TOKEN` and raise the budget. Test a like task on
   a **small** post first, where the whole engager list fits inside the cap.

Restart the bot after any env change:

```bash
pm2 restart kos-bot --update-env
```

## 6. Sizing the budget

The ledger counts **requests**, so `X_VERIFY_MONTHLY_READ_BUDGET × $0.010` is an
upper bound on spend, not a forecast. Real billing lands lower, because X
deduplicates identical resources within a 24-hour UTC window.

Rough shape for one raffle:

- **Follows:** the resource fetched is the *target account*, so all members
  checking the same target on the same day collapse to about one charge.
  Two follow targets over a five-day raffle ≈ 10 billable reads, ≈ $0.10.
  The ledger will still count one per member — that is the over-count.
- **Likes / reposts:** one sweep per post per `X_SWEEP_TTL_MINUTES`, up to
  `X_SWEEP_MAX_PAGES × 100` reads. At the default cap that is 2,001 reads
  (≈ $20 upper bound) for a post larger than the cap, and far less for a small
  one — a 300-like post is 4 reads.

`X_SWEEP_MAX_PAGES` is the real cost control: it is the hard ceiling on what a
single post can ever bill, no matter how viral it goes.

## 7. Reading `/admin/health`

The **X task verification** row shows the mode, reads used against the budget,
and an upper-bound dollar figure. A green dot means real verification is running
and budget remains. Amber means one of: mode `off`, credentials missing, or the
month's budget spent.

If it reads `follows only — sweeps need X_BEARER_TOKEN`, the mode is `full` but
the bearer token is missing, so likes and reposts are still attesting.

## 8. What happens when things go wrong

Verification **fails open**. Every inconclusive answer falls back to link +
attest — the exact behaviour that preceded this feature — rather than rejecting.
A billing lapse or an X outage must never cost a member a task they really did.

Falls back to attest:

- Monthly budget spent, or X credits exhausted
- Rate limited (429)
- X returns an error, or the network fails
- `connection_status` missing from the response (access level too low)
- A like/repost sweep that could not be proven complete

Only two things produce a real *Pending*: a completed lookup showing the member
does not follow, and a **proven-complete** sweep that does not contain them.

## Troubleshooting

**Everything still says "attested".** Check both guards are set — mode *and* a
non-zero budget — and that the app was restarted with the new env. `/admin/health`
tells you which one is missing.

**401/403 on every check.** Confirm the app is a *confidential* client (Web App
/ Automated App), not a public one; the token exchange uses HTTP Basic with the
client secret. There are also community reports of user-context calls returning
401/403 on pay-per-use apps specifically — verify one check end-to-end before
opening a raffle on it.

**Follows never verify, and evidence shows `unavailable`.** `connection_status`
is not being returned for your access level. Nothing is broken and members are
not blocked, but you are paying for lookups that cannot answer — set the mode
back to `off` until the access level is sorted.

**A member reposted but it won't verify.** `retweet_count` excludes quote posts.
A quote is not a repost; they need to repost it directly.

**Likes stop verifying during a busy raffle.** Both engagement endpoints allow
only 75 requests per 15 minutes *app-wide* — roughly three full sweeps at the
default cap. Raise `X_SWEEP_TTL_MINUTES` so cached sets are reused for longer;
lowering it makes this worse, not better.

**A big post never verifies anyone.** Its engager list is larger than
`X_SWEEP_MAX_PAGES × 100`, so the sweep can never be proven complete and every
member attests. Raise the cap deliberately — cost scales with it — or accept
attest for that post.

## Turning it off

Set `X_VERIFY_MODE="off"` and restart. Spending stops immediately and every X
task returns to link + attest. No deploy or migration rollback is needed, and
already-verified completions stay verified.
