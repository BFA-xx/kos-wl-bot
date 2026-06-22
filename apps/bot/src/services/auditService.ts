import { prisma, LogCategory, type Prisma } from "@kos/db";
import { logger } from "../logger.js";

interface AuditInput {
  guildId: string;
  category: LogCategory;
  action: string;
  message: string;
  actorId?: string | null;
  raffleId?: number | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Append an immutable audit-log row. Audit logging must never break the
 * primary flow, so failures are logged and swallowed.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.log.create({
      data: {
        guildId: input.guildId,
        category: input.category,
        action: input.action,
        message: input.message,
        actorId: input.actorId ?? null,
        raffleId: input.raffleId ?? null,
        metadata: input.metadata,
      },
    });
  } catch (err) {
    logger.error({ err, action: input.action }, "failed to write audit log");
  }
}
