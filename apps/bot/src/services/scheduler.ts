import { type Client } from "discord.js";
import { prisma, LogCategory, RaffleStatus } from "@kos/db";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { refreshRaffleMessage } from "./raffleService.js";
import { closeAndDraw } from "./winnerService.js";
import { audit } from "./auditService.js";

/**
 * Sweep-based scheduler. A single interval drives all raffle state machines,
 * which makes it crash-safe (state is recomputed from the DB every tick rather
 * than relying on in-memory timers that vanish on restart).
 */
export class Scheduler {
  private transitionTimer?: NodeJS.Timeout;
  private refreshTimer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly client: Client) {}

  start(): void {
    const transitionMs = config.SCHEDULER_TICK_SECONDS * 1000;
    const refreshMs = config.EMBED_REFRESH_SECONDS * 1000;

    this.transitionTimer = setInterval(() => void this.tick(), transitionMs);
    this.refreshTimer = setInterval(() => void this.refreshLive(), refreshMs);

    logger.info(
      { transitionMs, refreshMs },
      "scheduler started (transition + refresh loops)",
    );

    // Kick an immediate tick so restarts catch up instantly.
    void this.tick();
  }

  stop(): void {
    if (this.transitionTimer) clearInterval(this.transitionTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  /** Open due UPCOMING raffles and close+draw due LIVE raffles. */
  private async tick(): Promise<void> {
    if (this.running) return; // prevent overlap on slow draws
    this.running = true;
    const now = new Date();
    try {
      // Open upcoming raffles whose start time has arrived.
      const toOpen = await prisma.raffle.findMany({
        where: { status: RaffleStatus.UPCOMING, startAt: { lte: now } },
        select: { id: true, guildId: true },
      });
      for (const r of toOpen) {
        await prisma.raffle.update({
          where: { id: r.id },
          data: { status: RaffleStatus.LIVE },
        });
        await audit({
          guildId: r.guildId,
          raffleId: r.id,
          category: LogCategory.RAFFLE,
          action: "RAFFLE_OPEN",
          message: `Raffle #${r.id} is now LIVE`,
        });
        await refreshRaffleMessage(this.client, r.id).catch(() => undefined);
        logger.info({ raffleId: r.id }, "raffle opened");
      }

      // Close + draw live raffles whose end time has passed.
      const toClose = await prisma.raffle.findMany({
        where: { status: RaffleStatus.LIVE, endAt: { lte: now } },
        select: { id: true },
      });
      for (const r of toClose) {
        logger.info({ raffleId: r.id }, "raffle ending — drawing winners");
        await closeAndDraw(this.client, r.id).catch((err) =>
          logger.error({ err, raffleId: r.id }, "auto close/draw failed"),
        );
      }
    } catch (err) {
      logger.error({ err }, "scheduler tick failed");
    } finally {
      this.running = false;
    }
  }

  /** Refresh live raffle embeds so countdowns and counts stay current. */
  private async refreshLive(): Promise<void> {
    try {
      const live = await prisma.raffle.findMany({
        where: { status: RaffleStatus.LIVE, messageId: { not: null } },
        select: { id: true },
      });
      for (const r of live) {
        await refreshRaffleMessage(this.client, r.id).catch(() => undefined);
      }
    } catch (err) {
      logger.error({ err }, "scheduler refresh failed");
    }
  }
}
