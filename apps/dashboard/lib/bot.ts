/**
 * Thin client for the bot's internal control API (reroll / end). The bot binds
 * that API to 127.0.0.1; the dashboard must run on the same host (or reach it
 * over a private network) and share INTERNAL_API_TOKEN.
 */
const BASE = process.env.BOT_INTERNAL_URL ?? "http://127.0.0.1:4000";
const TOKEN = process.env.INTERNAL_API_TOKEN;

export interface BotCallResult {
  ok: boolean;
  status: number;
  body: unknown;
}

export async function callBot(
  path: string,
  body: Record<string, unknown> = {},
): Promise<BotCallResult> {
  if (!TOKEN) {
    return { ok: false, status: 500, body: { error: "INTERNAL_API_TOKEN not configured" } };
  }
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body: json };
  } catch (err) {
    return { ok: false, status: 502, body: { error: String(err) } };
  }
}
