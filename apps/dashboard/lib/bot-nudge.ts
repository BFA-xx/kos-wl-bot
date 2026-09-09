/**
 * Tell the bot that something it must act on has just been written.
 *
 * The bot's scheduler sleeps up to SCHEDULER_IDLE_SECONDS between sweeps so
 * the Postgres compute can suspend — that idle time is essentially the whole
 * database bill. The cost of that sleep is latency on anything the dashboard
 * writes: a new raffle is only a DRAFT row, a reroll is only a flag, and a
 * Telegram announcement is only a PENDING delivery. None of them can announce
 * themselves, so before this they waited out the sweep. Production measured
 * a median of 14s but a p90 of 344s and a worst case of 802s.
 *
 * There is no HTTP route from here to the bot: this app runs on Vercel and the
 * bot's internal API binds to 127.0.0.1 on its own host. What both processes
 * share is Discord — the bot holds a gateway socket, and this app holds the
 * bot token. So a marker message in a private control channel reaches it in
 * milliseconds, without a public port on the bot's box and without keeping the
 * database awake.
 *
 * Strictly an optimisation. Every failure mode here — no channel configured,
 * no token, a rate limit, a timeout — costs only the old wait, because the
 * bot's sweep still recomputes everything from the database. So this never
 * throws and never fails a request.
 */
export async function nudgeBot(reason: string): Promise<void> {
  const channelId = process.env.DISCORD_CONTROL_CHANNEL_ID;
  const token =
    process.env.DISCORD_BOT_TOKEN ||
    process.env.BOT_TOKEN ||
    process.env.DISCORD_TOKEN;
  if (!channelId || !token) return;

  try {
    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bot ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: reason.slice(0, 180),
        // A control marker must never ping anyone, whatever the reason says.
        allowed_mentions: { parse: [] },
      }),
      cache: "no-store",
      // Discord being slow must not become the dashboard being slow. Awaited
      // rather than fired and forgotten because Next 14 gives no guarantee
      // that work outlives the response on serverless.
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    // Deliberately silent: the sweep is the backstop.
  }
}
