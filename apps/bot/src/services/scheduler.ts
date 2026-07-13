import { type Client } from "discord.js";
import { prisma, Prisma, LogCategory, RaffleStatus } from "@kos/db";
import { config } from "../config.js";
import { logger } from "../logger.js";
import {
  deleteRaffle,
  publishRaffleMessage,
  repostRaffleMessage,
  refreshRaffleMessage,
} from "./raffleService.js";
import {
  closeAndDraw,
  rerollWinners,
  type RerollMode,
} from "./winnerService.js";
import { audit } from "./auditService.js";
import { processCollaborationAutomations } from "./collaborationService.js";
import { backfillProofArtifacts } from "./proofService.js";

/**
 * Sweep-based scheduler. A single interval drives all raffle state machines,
 * which makes it crash-safe (state is recomputed from the DB every tick rather
 * than relying on in-memory timers that vanish on restart).
 *
 * The live raffle post is intentionally NOT edited on a timer — the countdown
 * uses Discord's native relative timestamp (client-side, no edit), so the post
 * keeps its clean @everyone ping with no "(edited)" tag.
 */
export class Scheduler {
  private transitionTimer?: NodeJS.Timeout;
  private running = false;
  private lastHeartbeat = 0;
  private lastCollaborationSweep = 0;

  constructor(private readonly client: Client) {}

  start(): void {
    const transitionMs = config.SCHEDULER_TICK_SECONDS * 1000;
    this.transitionTimer = setInterval(() => void this.tick(), transitionMs);
    logger.info({ transitionMs }, "scheduler started (transition loop)");

    // Kick an immediate tick so restarts catch up instantly.
    void this.tick();
  }

  stop(): void {
    if (this.transitionTimer) clearInterval(this.transitionTimer);
  }

  /**
   * Liveness heartbeat for the Super Admin health page (the dashboard can't
   * reach the bot's localhost API from Vercel, so status flows via the DB).
   * Throttled to ~1 write/minute.
   */
  private async heartbeat(): Promise<void> {
    if (Date.now() - this.lastHeartbeat < 60_000) return;
    this.lastHeartbeat = Date.now();
    const value = JSON.stringify({
      guilds: this.client.guilds.cache.size,
      user: this.client.user?.tag ?? null,
    });
    await prisma.systemStatus
      .upsert({
        where: { key: "bot-heartbeat" },
        create: { key: "bot-heartbeat", value },
        update: { value },
      })
      .catch(() => undefined);
  }

  /** Open due UPCOMING raffles and close+draw due LIVE raffles. */
  private async tick(): Promise<void> {
    if (this.running) return; // prevent overlap on slow draws
    this.running = true;
    const now = new Date();
    try {
      // Post raffles created from the dashboard, and run dashboard reroll
      // requests. This is how the Vercel dashboard drives the bot (they share
      // only the DB — the dashboard can't reach the bot's local API).
      await this.heartbeat();
      if (Date.now() - this.lastCollaborationSweep >= 60_000) {
        this.lastCollaborationSweep = Date.now();
        await processCollaborationAutomations().catch((err) =>
          logger.warn({ err }, "Collab Hub automation sweep failed"),
        );
        await backfillProofArtifacts(this.client).catch((err) =>
          logger.warn({ err }, "proof artifact backfill failed"),
        );
      }
      await this.processDeleteRequests();
      await this.publishDashboardRaffles();
      await this.processRerollRequests();
      await this.processEditRequests();

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
        // Re-post so the ping fires and the LIVE post is clean (see class doc).
        await repostRaffleMessage(this.client, r.id).catch(() => undefined);
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

  /** Remove dashboard-deleted raffle posts, proof files, and DB records. */
  private async processDeleteRequests(): Promise<void> {
    const requests = await prisma.log.findMany({
      where: {
        action: "RAFFLE_DELETE_REQUEST",
        raffleId: { not: null },
      },
      orderBy: { createdAt: "asc" },
      take: 25,
      select: { id: true, raffleId: true, actorId: true },
    });
    for (const request of requests) {
      if (!request.raffleId) continue;
      await deleteRaffle(
        request.raffleId,
        request.actorId ?? "dashboard",
        this.client,
      ).catch((err) =>
        logger.error(
          { err, raffleId: request.raffleId },
          "dashboard raffle deletion failed",
        ),
      );
    }
  }

  /**
   * Publish raffles the dashboard created (status DRAFT + a channel set). The
   * dashboard writes the row; we set the real status and post it to Discord.
   */
  private async publishDashboardRaffles(): Promise<void> {
    const drafts = await prisma.raffle.findMany({
      where: { status: RaffleStatus.DRAFT, channelId: { not: null } },
      select: { id: true, guildId: true, startAt: true },
    });
    for (const r of drafts) {
      const status =
        r.startAt.getTime() <= Date.now()
          ? RaffleStatus.LIVE
          : RaffleStatus.UPCOMING;
      await prisma.raffle.update({ where: { id: r.id }, data: { status } });
      const res = await publishRaffleMessage(this.client, r.id).catch((err) => {
        logger.error({ err, raffleId: r.id }, "dashboard raffle publish threw");
        return { ok: false as const, reason: "internal error" };
      });
      if (res.ok) {
        logger.info({ raffleId: r.id }, "published dashboard-created raffle");
      } else {
        // Don't loop forever on a bad channel — cancel and surface the reason.
        await prisma.raffle
          .update({
            where: { id: r.id },
            data: { status: RaffleStatus.CANCELLED },
          })
          .catch(() => undefined);
        await audit({
          guildId: r.guildId,
          raffleId: r.id,
          category: LogCategory.SYSTEM,
          action: "PUBLISH_FAILED",
          message: `Dashboard raffle could not be posted: ${res.reason ?? "unknown"}`,
        }).catch(() => undefined);
        logger.warn(
          { raffleId: r.id, reason: res.reason },
          "dashboard raffle publish failed → cancelled",
        );
      }
    }
  }

  /** Run reroll requests the dashboard wrote to the DB, then clear them. */
  private async processRerollRequests(): Promise<void> {
    const pending = await prisma.raffle.findMany({
      where: { rerollRequestedAt: { not: null } },
      select: { id: true, rerollRequest: true },
    });
    for (const r of pending) {
      // Clear FIRST so a failure can't loop.
      await prisma.raffle
        .update({
          where: { id: r.id },
          data: { rerollRequest: Prisma.DbNull, rerollRequestedAt: null },
        })
        .catch(() => undefined);
      const req = (r.rerollRequest ?? {}) as {
        mode?: RerollMode;
        count?: number;
        userIds?: string[];
        actorId?: string;
      };
      await rerollWinners(this.client, r.id, req.actorId ?? "dashboard", {
        mode: req.mode ?? "all",
        count: req.count,
        userIds: req.userIds,
      }).catch((err) =>
        logger.error({ err, raffleId: r.id }, "dashboard reroll failed"),
      );
    }
  }

  /** Re-render the Discord post for raffles the dashboard edited. */
  private async processEditRequests(): Promise<void> {
    const edits = await prisma.raffle.findMany({
      where: { editRequestedAt: { not: null }, messageId: { not: null } },
      select: { id: true },
    });
    for (const r of edits) {
      await prisma.raffle
        .update({ where: { id: r.id }, data: { editRequestedAt: null } })
        .catch(() => undefined);
      await refreshRaffleMessage(this.client, r.id).catch((err) =>
        logger.error({ err, raffleId: r.id }, "dashboard edit refresh failed"),
      );
    }
  }
}
