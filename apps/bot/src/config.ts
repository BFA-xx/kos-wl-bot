import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

// Load the first .env found, searching from the current working directory up to
// the monorepo root. This makes the bot pick up the root .env whether it's run
// from the repo root (prod / PM2) or from apps/bot (pnpm --filter dev). In
// Docker, env vars are injected directly and none of these paths exist (no-op).
// Must run before any process.env access below.
for (const candidate of [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "..", ".env"),
  resolve(process.cwd(), "..", "..", ".env"),
]) {
  if (existsSync(candidate)) {
    loadEnv({ path: candidate });
    break;
  }
}

// Treat empty-string env values as "unset" for optional URL fields, so a blank
// KOS_LOGO_URL="" in .env doesn't fail .url() validation.
const optionalUrl = z.preprocess(
  (v) => (v === "" || v === undefined ? undefined : v),
  z.string().url().optional(),
);

const optionalString = (schema: z.ZodString) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    schema.optional(),
  );

/**
 * Centralised, validated runtime configuration.
 *
 * Fails fast on boot if a required environment variable is missing or
 * malformed, so the process never starts in a half-configured state.
 */
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
  /** Optional: when set, slash commands register instantly to this guild (dev). */
  DISCORD_GUILD_ID: z.string().optional(),

  DATABASE_URL: z.string().url("DATABASE_URL must be a valid connection URL"),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  /** Where generated proof artifacts (PDF/CSV/PNG) are written. */
  PROOF_OUTPUT_DIR: z.string().default("./generated/proofs"),

  /** How often (seconds) live LIVE-raffle embeds are refreshed. */
  EMBED_REFRESH_SECONDS: z.coerce.number().int().positive().default(30),

  /** Floor between scheduler ticks (seconds) when work is due back-to-back. */
  SCHEDULER_TICK_SECONDS: z.coerce.number().int().positive().default(15),

  /**
   * Longest the scheduler will sleep when nothing is due (seconds).
   *
   * Timed work (raffle/campaign open + close) wakes exactly on its own
   * deadline, so this only bounds how long a *dashboard-written* request
   * (publish/reroll/edit/delete) waits before the bot notices it. It is also
   * the single biggest lever on the Neon bill: the database is only billed
   * while a compute is awake, and it can only suspend while nobody is
   * connected. 900s keeps the compute idle ~2/3 of the time.
   */
  SCHEDULER_IDLE_SECONDS: z.coerce.number().int().positive().default(900),

  /**
   * How long after the last dashboard request we keep sweeping at the fast
   * cadence. An open dashboard already polls the database every few seconds,
   * so the compute is awake anyway and sweeping quickly costs nothing — it
   * just means a publish/reroll/edit lands in seconds instead of waiting out
   * SCHEDULER_IDLE_SECONDS.
   */
  DASHBOARD_PRESENCE_SECONDS: z.coerce.number().int().positive().default(120),

  /** Maximum records processed per scheduler operation and tick. */
  SCHEDULER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),

  /** Max enter/leave actions per user per minute (anti-spam). */
  ENTRY_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(8),

  /** Public dashboard URL, used in proof embeds when present. */
  DASHBOARD_URL: optionalUrl,

  /** Stable public raffle origin. Must not be a temporary deployment URL. */
  PUBLIC_RAFFLE_ORIGIN: z.string().url().default("https://raffle.koslabs.app"),

  /** Telegram is feature-disabled when no token is configured. */
  TELEGRAM_BOT_TOKEN: optionalString(z.string().min(20)),
  TELEGRAM_BOT_USERNAME: optionalString(
    z.string().regex(/^[A-Za-z0-9_]{5,32}$/u),
  ),

  /**
   * 32-byte hex key (64 hex chars) enabling AES-256-GCM encryption of wallet
   * addresses at rest. When unset, addresses are stored in plaintext and a
   * warning is logged at boot.
   */
  WALLET_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/u, "WALLET_ENCRYPTION_KEY must be 64 hex chars")
    .optional(),

  /** Branding overrides. */
  KOS_BRAND_NAME: z.string().default("KOS Raffles"),
  KOS_LOGO_URL: optionalUrl,

  /**
   * Internal control API (used by the dashboard for reroll/end actions that
   * must trigger live Discord announcements). Bound to 127.0.0.1 only.
   * Disabled unless both port and a strong token are set.
   */
  INTERNAL_API_PORT: z.coerce.number().int().positive().optional(),
  INTERNAL_API_TOKEN: z.string().min(24).optional(),
  /** Bind address for the internal API. Keep 127.0.0.1 on a VPS; use 0.0.0.0
   *  only inside an isolated Docker network. */
  INTERNAL_API_HOST: z.string().default("127.0.0.1"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
