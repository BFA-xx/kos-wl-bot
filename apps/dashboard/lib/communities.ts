import type { Prisma } from "@prisma/client";

export function communityHasGuildMembership(
  guildConnections: { guildId: string }[],
  memberGuildIds: ReadonlySet<string>,
): boolean {
  return guildConnections.some((connection) =>
    memberGuildIds.has(connection.guildId),
  );
}

/**
 * Every guild connected to a community the member belongs to. Being in any
 * one of a community's servers counts for all of them — the same rule the
 * Communities directory uses to decide what is "yours".
 */
export function memberCommunityGuildIds(
  communities: { guildConnections: { guildId: string }[] }[],
  memberGuildIds: ReadonlySet<string>,
): Set<string> {
  const guildIds = new Set<string>();
  for (const community of communities) {
    if (
      !communityHasGuildMembership(community.guildConnections, memberGuildIds)
    )
      continue;
    for (const connection of community.guildConnections)
      guildIds.add(connection.guildId);
  }
  return guildIds;
}

/**
 * Prisma filter for the raffles that belong on a member's own pages: those
 * from their communities, plus any they already entered. An entry outlives
 * leaving the server and still needs somewhere to show its result — and it
 * is the one thing still worth showing when membership can't be read.
 */
export function memberRaffleWhere(
  userId: string,
  communityGuildIds: ReadonlySet<string>,
): Prisma.RaffleWhereInput {
  return {
    OR: [
      { guildId: { in: [...communityGuildIds] } },
      { participants: { some: { userId } } },
    ],
  };
}
