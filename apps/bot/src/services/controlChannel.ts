import type { Message } from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

/**
 * Push channel for work the dashboard writes straight to the database.
 *
 * The scheduler sleeps up to SCHEDULER_IDLE_SECONDS between ticks so the
 * Postgres compute can suspend, and it disconnects while it waits. That is
 * fine for timed transitions, which wake on their own deadline, but a raffle
 * created from the dashboard is only a DRAFT row — nothing tells the bot it
 * exists, so it sat unposted until the next sweep. Measured in production:
 * three raffles created three minutes apart all posted 1.5 seconds apart,
 * the first of them 8m15s late.
 *
 * Presence (see the dashboard's lib/presence.ts) does not close that gap. It
 * is read only when the scheduler picks its next sleep length, so an operator
 * arriving mid-sleep can shorten the *next* wait but never the one already
 * running.
 *
 * The dashboard runs on Vercel and the internal control API binds to
 * 127.0.0.1, so there is no HTTP route between the two. What they do share is
 * Discord: the bot already holds a gateway socket and the dashboard already
 * holds the bot token. A marker message in a private channel therefore
 * crosses in milliseconds, costs no database time, and opens no new inbound
 * surface on the bot's host.
 *
 * This is a latency optimisation and nothing more. A nudge that is dropped,
 * rate-limited, or never sent costs only the old wait, because every sweep
 * still recomputes state from the database.
 */
export function handleControlMessage(
  message: Message,
  wake: (reason: string) => void,
): void {
  const channelId = config.CONTROL_CHANNEL_ID;
  if (!channelId || message.channelId !== channelId) return;

  // The dashboard posts with this bot's own token, so the marker arrives as a
  // self-authored message — discord.js delivers those, and holding the token
  // is what authorises the wake. A stray human message in the channel is
  // ignored rather than trusted.
  const selfId = message.client.user?.id;
  if (!selfId || message.author.id !== selfId) return;

  // Content is only ever a log label. A wake takes no arguments, so nothing
  // here can steer the bot beyond making it sweep sooner than planned.
  const label = message.content.slice(0, 120).replace(/\s+/gu, " ").trim();
  wake(`dashboard nudge${label ? `: ${label}` : ""}`);

  // Keep the channel from growing without bound. The wake is already logged,
  // so the marker has no value once it has been acted on.
  void message.delete().catch((err) => {
    logger.debug(
      { err, messageId: message.id },
      "control marker delete failed",
    );
  });
}
