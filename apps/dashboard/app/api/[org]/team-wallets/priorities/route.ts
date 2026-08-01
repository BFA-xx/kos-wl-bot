import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logAudit, requireOrgAccess, withAccess } from "@/lib/access";
import {
  canManageAllTeamWallets,
  ensureDefaultTeamWalletPool,
  organizationTeamMembers,
} from "@/lib/team-wallet-server";
import type { TeamWalletSelectionMode } from "@/lib/team-wallet-pool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODES = new Set<TeamWalletSelectionMode>([
  "ROUND_ROBIN",
  "RANDOM",
  "PRIORITY",
]);

export const PATCH = withAccess(async (request, { params }) => {
  const access = await requireOrgAccess(params.org);
  if (!canManageAllTeamWallets(access)) {
    return NextResponse.json(
      { error: "Only organization admins can arrange wallet priority." },
      { status: 403 },
    );
  }
  const body = await request.json().catch(() => ({}));
  const userIds: string[] = Array.isArray(body.userIds)
    ? [
        ...new Set<string>(
          (body.userIds as unknown[]).filter(
            (value: unknown): value is string => typeof value === "string",
          ),
        ),
      ]
    : [];
  const selectionMode = String(
    body.selectionMode ?? "ROUND_ROBIN",
  ) as TeamWalletSelectionMode;
  if (!MODES.has(selectionMode)) {
    return NextResponse.json(
      { error: "Unknown selection mode." },
      { status: 400 },
    );
  }
  const members = await organizationTeamMembers(
    access.org.id,
    access.org.ownerId,
  );
  const memberIds = new Set(members.map((member) => member.userId));
  if (
    userIds.length !== memberIds.size ||
    userIds.some((userId) => !memberIds.has(userId))
  ) {
    return NextResponse.json(
      { error: "Priority must include every active team member exactly once." },
      { status: 400 },
    );
  }
  const pool = await ensureDefaultTeamWalletPool(access.org.id);
  await prisma.$transaction(async (tx) => {
    await tx.teamWalletPool.update({
      where: { id: pool.id },
      data: { selectionMode },
    });
    for (const [priority, userId] of userIds.entries()) {
      await tx.teamWalletPoolMember.upsert({
        where: { poolId_userId: { poolId: pool.id, userId } },
        create: { poolId: pool.id, userId, priority },
        update: { priority },
      });
    }
  });
  await logAudit(
    access.org.id,
    access.user.id,
    "TEAM_WALLET_PRIORITY_CHANGED",
    {
      targetType: "team_wallet_pool",
      targetId: pool.id,
      metadata: { selectionMode, userIds },
    },
  );
  return NextResponse.json({ ok: true, selectionMode });
});
