import { prisma, LogCategory } from "@kos/db";
import { audit } from "./auditService.js";
import { upsertUser } from "./userService.js";

export async function isBlacklisted(
  guildId: string,
  userId: string,
): Promise<boolean> {
  const row = await prisma.blacklist.findUnique({
    where: { guildId_userId: { guildId, userId } },
    select: { id: true },
  });
  return row !== null;
}

export async function addToBlacklist(params: {
  guildId: string;
  userId: string;
  username: string;
  reason?: string;
  actorId: string;
}): Promise<{ created: boolean }> {
  await upsertUser({ id: params.userId, username: params.username });

  const existing = await prisma.blacklist.findUnique({
    where: { guildId_userId: { guildId: params.guildId, userId: params.userId } },
  });
  if (existing) return { created: false };

  await prisma.blacklist.create({
    data: {
      guildId: params.guildId,
      userId: params.userId,
      reason: params.reason,
      addedById: params.actorId,
    },
  });

  await audit({
    guildId: params.guildId,
    category: LogCategory.BLACKLIST,
    action: "BLACKLIST_ADD",
    message: `Blacklisted ${params.username} (${params.userId})${
      params.reason ? `: ${params.reason}` : ""
    }`,
    actorId: params.actorId,
  });

  return { created: true };
}

export async function removeFromBlacklist(params: {
  guildId: string;
  userId: string;
  actorId: string;
}): Promise<{ removed: boolean }> {
  const existing = await prisma.blacklist.findUnique({
    where: { guildId_userId: { guildId: params.guildId, userId: params.userId } },
  });
  if (!existing) return { removed: false };

  await prisma.blacklist.delete({ where: { id: existing.id } });

  await audit({
    guildId: params.guildId,
    category: LogCategory.BLACKLIST,
    action: "BLACKLIST_REMOVE",
    message: `Removed ${params.userId} from blacklist`,
    actorId: params.actorId,
  });

  return { removed: true };
}

export async function listBlacklist(guildId: string) {
  return prisma.blacklist.findMany({
    where: { guildId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
