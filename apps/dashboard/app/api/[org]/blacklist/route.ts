import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, logAudit } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { org: string } }) {
  try {
    const { guildIds } = await requireOrgAccess(params.org, PERMISSIONS.PARTICIPANT_VIEW);
    const [rows, guilds] = await Promise.all([
      prisma.blacklist.findMany({
        where: { guildId: { in: guildIds } },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      prisma.guild.findMany({ where: { id: { in: guildIds } }, select: { id: true, name: true } }),
    ]);
    return NextResponse.json({ rows, guilds });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { org: string } }) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(params.org, PERMISSIONS.SETTINGS_EDIT);
    const body = await req.json().catch(() => ({}));
    const { guildId, userId, reason } = body as { guildId?: string; userId?: string; reason?: string };
    if (!guildId || !userId) {
      return NextResponse.json({ error: "guildId and userId required" }, { status: 400 });
    }
    if (!guildIds.includes(guildId)) {
      return NextResponse.json({ error: "That server isn't connected to this org." }, { status: 403 });
    }

    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, username: "unknown" },
      update: {},
    });
    const row = await prisma.blacklist.upsert({
      where: { guildId_userId: { guildId, userId } },
      create: { guildId, userId, reason, addedById: user.id },
      update: { reason },
    });
    await logAudit(org.id, user.id, "BLACKLIST_ADD", { targetType: "user", targetId: userId });
    return NextResponse.json({ row });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { org: string } }) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(params.org, PERMISSIONS.SETTINGS_EDIT);
    const guildId = req.nextUrl.searchParams.get("guildId");
    const userId = req.nextUrl.searchParams.get("userId");
    if (!guildId || !userId) {
      return NextResponse.json({ error: "guildId and userId required" }, { status: 400 });
    }
    if (!guildIds.includes(guildId)) {
      return NextResponse.json({ error: "That server isn't connected to this org." }, { status: 403 });
    }
    await prisma.blacklist
      .delete({ where: { guildId_userId: { guildId, userId } } })
      .catch(() => null);
    await logAudit(org.id, user.id, "BLACKLIST_REMOVE", { targetType: "user", targetId: userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
