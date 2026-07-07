import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, logAudit } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface WeightInput {
  guildId?: unknown;
  roleId?: unknown;
  roleName?: unknown;
  multiplier?: unknown;
}

export async function GET(
  _req: Request,
  { params }: { params: { org: string } },
) {
  try {
    const { org } = await requireOrgAccess(params.org);
    const weights = await prisma.roleWeight.findMany({
      where: { organizationId: org.id },
      orderBy: [{ guildId: "asc" }, { roleName: "asc" }],
      select: {
        id: true,
        guildId: true,
        roleId: true,
        roleName: true,
        multiplier: true,
        updatedAt: true,
      },
    });
    return NextResponse.json({ weights });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** Replace an organization's role-weight table. Multipliers of 1 are defaults and are not stored. */
export async function PUT(
  req: Request,
  { params }: { params: { org: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.SETTINGS_EDIT,
    );
    const body = await req.json().catch(() => ({}));
    const raw = Array.isArray(body.weights)
      ? (body.weights as WeightInput[])
      : [];
    const scopedGuilds = new Set(guildIds);
    const byRole = new Map<
      string,
      { guildId: string; roleId: string; roleName: string; multiplier: number }
    >();

    for (const item of raw.slice(0, 500)) {
      const guildId = typeof item.guildId === "string" ? item.guildId : "";
      const roleId = typeof item.roleId === "string" ? item.roleId : "";
      const roleName =
        typeof item.roleName === "string" ? item.roleName.trim() : roleId;
      const multiplier = Math.max(
        1,
        Math.min(100, Math.round(Number(item.multiplier) || 1)),
      );
      if (!scopedGuilds.has(guildId)) continue;
      if (!/^\d{5,25}$/.test(roleId)) continue;
      if (multiplier <= 1) continue;
      byRole.set(roleId, {
        guildId,
        roleId,
        roleName: roleName.slice(0, 100) || roleId,
        multiplier,
      });
    }

    const weights = [...byRole.values()];
    await prisma.$transaction(async (tx) => {
      await tx.roleWeight.deleteMany({ where: { organizationId: org.id } });
      if (weights.length > 0) {
        await tx.roleWeight.createMany({
          data: weights.map((w) => ({ ...w, organizationId: org.id })),
        });
      }
    });

    await logAudit(org.id, user.id, "ROLE_WEIGHTS_UPDATE", {
      targetType: "organization",
      targetId: org.id,
      metadata: { count: weights.length },
    });

    return NextResponse.json({ ok: true, weights });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("role weights update failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
