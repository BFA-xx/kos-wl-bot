import { type Client } from "discord.js";
import {
  prisma,
  Prisma,
  CampaignStatus,
  LogCategory,
  RaffleStatus,
  enqueueTelegramRaffleEvent,
} from "@kos/db";
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
import { processRaidLifecycle } from "./raidService.js";
import { processVerificationControlRequests } from "./verificationControlService.js";
import { processTelegramDeliveries } from "./telegramService.js";

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
  private stopped = false;
  private running = false;
  private lastHeartbeat = 0;
  private lastCollaborationSweep = 0;
  private lastTickAt: string | null = null;
  private lastTickDurationMs: number | null = null;
  private lastTickOk: boolean | null = null;
  private nextTickAt: string | null = null;

  constructor(private readonly client: Client) {}

  start(): void {
    this.stopped = false;
    logger.info(
      {
        tickMs: config.SCHEDULER_TICK_SECONDS * 1000,
        idleMs: config.SCHEDULER_IDLE_SECONDS * 1000,
      },
      "scheduler started (adaptive loop)",
    );

    // Kick an immediate tick so restarts catch up instantly.
    void this.runLoop();
  }

  stop(): void {
    this.stopped = true;
    if (this.transitionTimer) clearTimeout(this.transitionTimer);
    this.transitionTimer = undefined;
  }

  /**
   * Tick, then sleep until the next thing is genuinely due.
   *
   * The previous loop swept on a fixed 15s interval whether or not anything
   * was pending, which meant ~11 queries every 15s forever. That kept a
   * connection on the Postgres compute permanently, so it never scaled to
   * zero — the idling, not the work, was the whole monthly bill. Timed
   * transitions now wake on their own deadline (more precise than a 15s
   * sweep, not less), and the sleep is capped by SCHEDULER_IDLE_SECONDS so
   * dashboard-written requests are still picked up without a push channel.
   *
   * Still crash-safe: state is recomputed from the DB on every tick, exactly
   * as before. Nothing is held in memory across a restart.
   */
  private async runLoop(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.tick();
    } catch (err) {
      // tick() already traps its own errors; this is belt-and-braces so an
      // unexpected throw can never leave the bot with no timer queued.
      logger.error({ err }, "scheduler tick threw outside its own handler");
    } finally {
      if (!this.stopped) await this.scheduleNextTick();
    }
  }

  private async scheduleNextTick(): Promise<void> {
    const tickMs = config.SCHEDULER_TICK_SECONDS * 1000;
    const idleMs = config.SCHEDULER_IDLE_SECONDS * 1000;

    const presenceMs = config.DASHBOARD_PRESENCE_SECONDS * 1000;

    let delay = idleMs;
    try {
      const [dueAt, activeAt] = await Promise.all([
        this.nextBoundaryAt(),
        this.dashboardActiveAt(),
      ]);
      // Somebody is on the dashboard. Their SWR polling is holding the compute
      // awake regardless, so sweeping at the normal cadence is free here, and
      // it is the only window in which dashboard-written requests appear.
      const operatorPresent =
        activeAt !== null && Date.now() - activeAt.getTime() < presenceMs;
      if (operatorPresent) {
        delay = tickMs;
      } else if (dueAt) {
        delay = Math.min(idleMs, dueAt.getTime() - Date.now());
      }
    } catch (err) {
      // A lookup failure must never stall the loop — fall back to the cap.
      logger.warn({ err }, "next-boundary lookup failed; sleeping for the cap");
    }
    delay = Math.max(tickMs, delay);

    // Release the connection so the compute can suspend while we wait. Prisma
    // reconnects lazily, so Discord interactions arriving mid-sleep still work
    // (they pay a cold start on the first query instead).
    if (delay >= 60_000) {
      await prisma.$disconnect().catch(() => undefined);
    }

    this.nextTickAt = new Date(Date.now() + delay).toISOString();
    this.transitionTimer = setTimeout(() => void this.runLoop(), delay);
  }

  /**
   * When the dashboard last served a request, or null if it never has. Written
   * by the dashboard's shared org guard — see apps/dashboard/lib/presence.ts.
   */
  private async dashboardActiveAt(): Promise<Date | null> {
    const row = await prisma.systemStatus.findUnique({
      where: { key: "dashboard-active" },
      select: { updatedAt: true },
    });
    return row?.updatedAt ?? null;
  }

  /**
   * Earliest moment a *timed* transition falls due, or null when the only
   * thing left to wait for is a dashboard request.
   */
  private async nextBoundaryAt(): Promise<Date | null> {
    const [raffleOpen, raffleClose, campaignOpen, campaignEnd] =
      await Promise.all([
        prisma.raffle.findFirst({
          where: { status: RaffleStatus.UPCOMING },
          orderBy: { startAt: "asc" },
          select: { startAt: true },
        }),
        prisma.raffle.findFirst({
          where: { status: RaffleStatus.LIVE },
          orderBy: { endAt: "asc" },
          select: { endAt: true },
        }),
        prisma.campaign.findFirst({
          where: { status: CampaignStatus.SCHEDULED, startAt: { not: null } },
          orderBy: { startAt: "asc" },
          select: { startAt: true },
        }),
        prisma.campaign.findFirst({
          where: { status: CampaignStatus.LIVE, endAt: { not: null } },
          orderBy: { endAt: "asc" },
          select: { endAt: true },
        }),
      ]);

    const due = [
      raffleOpen?.startAt,
      raffleClose?.endAt,
      campaignOpen?.startAt,
      campaignEnd?.endAt,
    ].filter((d): d is Date => d instanceof Date);

    if (due.length === 0) return null;
    return due.reduce((a, b) => (a < b ? a : b));
  }

  health() {
    return {
      running: this.running,
      lastTickAt: this.lastTickAt,
      lastTickDurationMs: this.lastTickDurationMs,
      lastTickOk: this.lastTickOk,
      nextTickAt: this.nextTickAt,
    };
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
      scheduler: this.health(),
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
    const startedAt = Date.now();
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
      await this.processCampaignLifecycle(now);
      await processVerificationControlRequests(
        this.client,
        config.SCHEDULER_BATCH_SIZE,
      );
      await processRaidLifecycle(this.client, now, config.SCHEDULER_BATCH_SIZE);

      // Open upcoming raffles whose start time has arrived.
      const toOpen = await prisma.raffle.findMany({
        where: { status: RaffleStatus.UPCOMING, startAt: { lte: now } },
        orderBy: [{ startAt: "asc" }, { id: "asc" }],
        take: config.SCHEDULER_BATCH_SIZE,
        select: { id: true, guildId: true, startAt: true },
      });
      this.warnIfBatchIsFull("raffles waiting to open", toOpen.length);
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
        await enqueueTelegramRaffleEvent(prisma, {
          raffleId: r.id,
          event: "RAFFLE_STARTING",
          marker: r.startAt.toISOString(),
        }).catch((err) =>
          logger.warn(
            { err, raffleId: r.id },
            "Telegram start event queue failed",
          ),
        );
        // Re-post so the ping fires and the LIVE post is clean (see class doc).
        await repostRaffleMessage(this.client, r.id).catch(() => undefined);
        logger.info({ raffleId: r.id }, "raffle opened");
      }

      // Close + draw live raffles whose end time has passed.
      const toClose = await prisma.raffle.findMany({
        where: { status: RaffleStatus.LIVE, endAt: { lte: now } },
        orderBy: [{ endAt: "asc" }, { id: "asc" }],
        take: config.SCHEDULER_BATCH_SIZE,
        select: { id: true },
      });
      this.warnIfBatchIsFull("raffles waiting to close", toClose.length);
      for (const r of toClose) {
        logger.info({ raffleId: r.id }, "raffle ending — drawing winners");
        await closeAndDraw(this.client, r.id).catch((err) =>
          logger.error({ err, raffleId: r.id }, "auto close/draw failed"),
        );
      }
      await processTelegramDeliveries(now, config.SCHEDULER_BATCH_SIZE).catch(
        (err) => logger.error({ err }, "Telegram delivery sweep failed"),
      );
      this.lastTickOk = true;
    } catch (err) {
      this.lastTickOk = false;
      logger.error({ err }, "scheduler tick failed");
    } finally {
      this.lastTickAt = new Date().toISOString();
      this.lastTickDurationMs = Date.now() - startedAt;
      this.running = false;
    }
  }

  private warnIfBatchIsFull(operation: string, count: number): void {
    if (count < config.SCHEDULER_BATCH_SIZE) return;
    logger.warn(
      { operation, count, batchSize: config.SCHEDULER_BATCH_SIZE },
      "scheduler batch reached its limit; remaining work continues next tick",
    );
  }

  /** Open and close dashboard-owned campaigns from their persisted schedule. */
  private async processCampaignLifecycle(now: Date): Promise<void> {
    const toOpen = await prisma.campaign.findMany({
      where: { status: CampaignStatus.SCHEDULED, startAt: { lte: now } },
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
      take: config.SCHEDULER_BATCH_SIZE,
      select: { id: true, organizationId: true },
    });
    this.warnIfBatchIsFull("campaigns waiting to open", toOpen.length);
    if (toOpen.length > 0) {
      await prisma.campaign.updateMany({
        where: {
          id: { in: toOpen.map((campaign) => campaign.id) },
          status: CampaignStatus.SCHEDULED,
        },
        data: { status: CampaignStatus.LIVE },
      });
      await prisma.auditLog
        .createMany({
          data: toOpen.map((campaign) => ({
            organizationId: campaign.organizationId,
            actorId: null,
            action: "CAMPAIGN_OPEN",
            targetType: "campaign",
            targetId: campaign.id,
          })),
        })
        .catch((err) =>
          logger.warn({ err }, "campaign open audit write failed"),
        );
    }

    const toEnd = await prisma.campaign.findMany({
      where: { status: CampaignStatus.LIVE, endAt: { lte: now } },
      orderBy: [{ endAt: "asc" }, { id: "asc" }],
      take: config.SCHEDULER_BATCH_SIZE,
      select: { id: true, organizationId: true },
    });
    this.warnIfBatchIsFull("campaigns waiting to end", toEnd.length);
    if (toEnd.length > 0) {
      await prisma.campaign.updateMany({
        where: {
          id: { in: toEnd.map((campaign) => campaign.id) },
          status: CampaignStatus.LIVE,
        },
        data: { status: CampaignStatus.ENDED },
      });
      await prisma.auditLog
        .createMany({
          data: toEnd.map((campaign) => ({
            organizationId: campaign.organizationId,
            actorId: null,
            action: "CAMPAIGN_END_AUTO",
            targetType: "campaign",
            targetId: campaign.id,
          })),
        })
        .catch((err) =>
          logger.warn({ err }, "campaign end audit write failed"),
        );
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
      take: config.SCHEDULER_BATCH_SIZE,
      select: { id: true, raffleId: true, actorId: true },
    });
    this.warnIfBatchIsFull("raffle deletion requests", requests.length);
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
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: config.SCHEDULER_BATCH_SIZE,
      select: { id: true, guildId: true, startAt: true },
    });
    this.warnIfBatchIsFull("dashboard raffle publishes", drafts.length);
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
      orderBy: [{ rerollRequestedAt: "asc" }, { id: "asc" }],
      take: config.SCHEDULER_BATCH_SIZE,
      select: { id: true, rerollRequest: true },
    });
    this.warnIfBatchIsFull("dashboard reroll requests", pending.length);
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
      orderBy: [{ editRequestedAt: "asc" }, { id: "asc" }],
      take: config.SCHEDULER_BATCH_SIZE,
      select: { id: true },
    });
    this.warnIfBatchIsFull("dashboard raffle edit requests", edits.length);
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
