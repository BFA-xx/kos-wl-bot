import { type Client, type Guild } from "discord.js";
import { LogCategory, prisma } from "@kos/db";
import { logger } from "../logger.js";
import { audit } from "./auditService.js";
import {
  publishVerificationPanel,
  clearVerificationRoleAccess,
  setVerificationEnabled,
  syncVerificationChannelAccess,
  VerificationSettingsError,
} from "./verificationSettingsService.js";

export interface VerificationControlSweepResult {
  found: number;
  processed: number;
  failed: number;
  superseded: number;
}

/**
 * Apply dashboard requests at the Discord authority boundary.
 *
 * Requests are acknowledged with a compare-and-clear on controlRequestId.
 * If an administrator saves again while a request is running, the newer id is
 * left untouched for the next scheduler tick.
 */
export async function processVerificationControlRequests(
  client: Client,
  take: number,
): Promise<VerificationControlSweepResult> {
  const requests = await prisma.verificationSettings.findMany({
    where: { controlRequestId: { not: null } },
    orderBy: [{ controlRequestedAt: "asc" }, { guildId: "asc" }],
    take,
    select: {
      guildId: true,
      desiredEnabled: true,
      accessSyncRequested: true,
      accessCleanupRoleIds: true,
      panelPublishRequested: true,
      controlRequestId: true,
      controlRequestedById: true,
    },
  });
  const result: VerificationControlSweepResult = {
    found: requests.length,
    processed: 0,
    failed: 0,
    superseded: 0,
  };

  for (const request of requests) {
    const requestId = request.controlRequestId;
    if (!requestId) continue;
    const actions: string[] = [];
    let failure: string | null = null;

    try {
      const guild = await resolveGuild(client, request.guildId);
      for (const roleId of request.accessCleanupRoleIds) {
        await clearVerificationRoleAccess(guild, roleId);
        actions.push(`old role access cleared (${roleId})`);
      }
      if (request.desiredEnabled !== null) {
        await setVerificationEnabled(guild, request.desiredEnabled);
        actions.push(request.desiredEnabled ? "enabled" : "disabled");
      } else if (request.accessSyncRequested) {
        await syncVerificationChannelAccess(guild);
        actions.push("access synced");
      }

      if (request.panelPublishRequested) {
        const published = await publishVerificationPanel(guild);
        actions.push(published.updated ? "panel updated" : "panel published");
      }
      if (actions.length === 0) actions.push("settings acknowledged");
    } catch (error) {
      failure = formatVerificationControlError(error);
    }

    const acknowledged = await prisma.verificationSettings.updateMany({
      where: {
        guildId: request.guildId,
        controlRequestId: requestId,
      },
      data: {
        desiredEnabled: null,
        accessSyncRequested: false,
        ...(failure ? {} : { accessCleanupRoleIds: { set: [] } }),
        panelPublishRequested: false,
        controlRequestId: null,
        controlRequestedAt: null,
        controlRequestedById: null,
        controlProcessedAt: new Date(),
        controlError: failure,
      },
    });
    if (acknowledged.count !== 1) {
      result.superseded += 1;
      logger.info(
        { guildId: request.guildId, requestId },
        "verification dashboard request superseded; preserving newer request",
      );
      continue;
    }

    if (failure) {
      result.failed += 1;
      logger.warn(
        { guildId: request.guildId, requestId, failure },
        "verification dashboard request failed",
      );
    } else {
      result.processed += 1;
      logger.info(
        { guildId: request.guildId, requestId, actions },
        "verification dashboard request applied",
      );
    }
    await audit({
      guildId: request.guildId,
      category: LogCategory.VERIFICATION,
      action: failure
        ? "VERIFICATION_WEB_CONTROL_FAILED"
        : "VERIFICATION_WEB_CONTROL_APPLIED",
      message: failure ?? `Dashboard request applied: ${actions.join(", ")}`,
      actorId: request.controlRequestedById ?? "dashboard",
      metadata: { requestId, actions },
    }).catch(() => undefined);
  }

  return result;
}

async function resolveGuild(client: Client, guildId: string): Promise<Guild> {
  const cached = client.guilds.cache.get(guildId);
  if (cached) return cached;
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    throw new Error(
      "KOS is not connected to this Discord server. Reconnect the server and try again.",
    );
  }
  return guild;
}

export function formatVerificationControlError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown verification control error.";
  const issues = error instanceof VerificationSettingsError ? error.issues : [];
  return [message, ...issues].filter(Boolean).join(" ").slice(0, 1800);
}
