import { prisma } from "@/lib/db";
import type { OrgContext } from "@/lib/access";

export function canManageAllTeamWallets(
  access: Pick<OrgContext, "isOwner" | "member">,
): boolean {
  return access.isOwner || access.member?.role.name === "Admin";
}

export async function ensureDefaultTeamWalletPool(organizationId: string) {
  return prisma.teamWalletPool.upsert({
    where: {
      organizationId_name: {
        organizationId,
        name: "Team Wallet Pool",
      },
    },
    create: {
      organizationId,
      name: "Team Wallet Pool",
      isDefault: true,
    },
    update: { isDefault: true },
  });
}

export async function organizationTeamMembers(
  organizationId: string,
  ownerId: string,
) {
  const memberships = await prisma.organizationMember.findMany({
    where: { organizationId, status: "ACTIVE" },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          globalName: true,
          avatarUrl: true,
        },
      },
      role: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: {
      id: true,
      username: true,
      globalName: true,
      avatarUrl: true,
    },
  });
  const byId = new Map(
    memberships.map((membership) => [
      membership.userId,
      {
        userId: membership.userId,
        name: membership.user.globalName ?? membership.user.username,
        avatarUrl: membership.user.avatarUrl,
        roleName: membership.role.name,
      },
    ]),
  );
  if (owner) {
    byId.set(owner.id, {
      userId: owner.id,
      name: owner.globalName ?? owner.username,
      avatarUrl: owner.avatarUrl,
      roleName: "Owner",
    });
  }
  return [...byId.values()];
}
