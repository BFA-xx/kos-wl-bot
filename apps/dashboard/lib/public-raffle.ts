import { cache } from "react";
import { prisma } from "@/lib/db";

/** Public-safe raffle payload used by SSR and Open Graph metadata. */
export const getPublicRaffle = cache(async (id: number) => {
  if (!Number.isSafeInteger(id) || id < 1) return null;

  const raffle = await prisma.raffle.findFirst({
    where: {
      id,
      status: { in: ["UPCOMING", "LIVE", "ENDED"] },
    },
    include: {
      guild: { select: { id: true, name: true, iconUrl: true } },
      eligibleRoles: { orderBy: { roleName: "asc" } },
      RaffleTask: {
        where: { task: { active: true } },
        orderBy: { id: "asc" },
        select: {
          required: true,
          task: {
            select: {
              id: true,
              title: true,
              description: true,
              type: true,
              config: true,
            },
          },
        },
      },
      winners: {
        where: { replaced: false },
        orderBy: { position: "asc" },
        select: { id: true, position: true, username: true },
      },
    },
  });
  if (!raffle) return null;

  const organization = await prisma.organization.findFirst({
    where: {
      suspendedAt: null,
      guildConnections: { some: { guildId: raffle.guildId } },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      logoUrl: true,
      description: true,
    },
  });
  if (!organization) return null;

  return { raffle, organization };
});
