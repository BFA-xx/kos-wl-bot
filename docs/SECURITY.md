# Security Best Practices

## Secrets

- Never commit `.env`. Only `.env.example` is tracked.
- Generate strong secrets:
  - `WALLET_ENCRYPTION_KEY` — `openssl rand -hex 32` (32 bytes / 64 hex).
  - `INTERNAL_API_TOKEN` — `openssl rand -hex 24` (min 24 chars).
  - `DASHBOARD_SESSION_TOKEN` — `openssl rand -hex 32`.
- Rotate the Discord token immediately if it ever leaks (Developer Portal → Bot → Reset Token).

## Wallet data at rest

- When `WALLET_ENCRYPTION_KEY` is set, wallet addresses are encrypted with
  **AES-256-GCM** (authenticated) before being written. The bot logs a warning
  on boot if the key is missing.
- Decryption happens only on export (`/raffle export`, dashboard CSV).
- Restrict who can export — exports contain plaintext wallets + Discord IDs.

## Permission model

- Slash commands set `setDefaultMemberPermissions(ManageGuild)` and are further
  checked at runtime (`isRaffleManager`): Administrator / Manage Server **or** a
  configured manager role.
- Member-facing buttons re-verify eligibility and blacklist on every click — the
  embed state is never trusted.

## Duplicate & race protection

- A unique `(raffleId, userId)` index makes double-entry impossible even under
  rapid concurrent clicks; the handler treats the unique violation as "already
  participating".
- Entry/leave and reroll run inside transactions to keep counts consistent.

## Anti-spam / rate limiting

- Per-user sliding-window limiter on Enter/Leave (`ENTRY_RATE_LIMIT_PER_MINUTE`).
- Live embed edits are debounced to avoid Discord rate-limit bans.

## Input validation

- Environment is validated with Zod at boot (fail-fast).
- Anti-alt requirements and time inputs are parsed/validated; invalid input is
  rejected with a helpful message rather than crashing.
- Wallet addresses are format-validated per chain before storage.

## Internal control API

- Bound to `127.0.0.1` by default (set `INTERNAL_API_HOST=0.0.0.0` only inside an
  isolated Docker network).
- Requires a bearer token compared in constant time (`timingSafeEqual`).
- **Never** expose port 4000 publicly or proxy it through Nginx.

## Dashboard access

- The bundled auth is a shared-secret session cookie (`httpOnly`, `secure` in
  production). Set `DASHBOARD_PASSWORD` + `DASHBOARD_SESSION_TOKEN` to enable it.
- For multi-user, audited access, replace it with **Discord OAuth** restricted to
  your guild's admin roles, and put the dashboard behind HTTPS (Nginx + certbot).
- Always run the dashboard behind TLS in production.

## Database

- Use a dedicated least-privilege Postgres role (owner of the `kos` database only).
- Keep the database on a private network / localhost; do not expose 5432 publicly.
- Prisma uses parameterized queries throughout (no string-built SQL).

## Operational

- Run under PM2 or Docker with `restart: unless-stopped` / autorestart.
- Back up the database and `generated/proofs` regularly (see DEPLOYMENT.md).
- Monitor `logs` table + process logs; every admin action is audited with actor,
  action, and metadata.
