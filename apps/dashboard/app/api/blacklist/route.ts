import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const guildId = req.nextUrl.searchParams.get("guildId") ?? undefined;
  const rows = await prisma.blacklist.findMany({
    where: guildId ? { guildId } : {},
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const guilds = await prisma.guild.findMany({ select: { id: true, name: true } });
  return NextResponse.json({ rows, guilds });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { guildId, userId, reason } = body as {
    guildId?: string;
    userId?: string;
    reason?: string;
  };
  if (!guildId || !userId) {
    return NextResponse.json({ error: "guildId and userId required" }, { status: 400 });
  }

  // Ensure referenced rows exist (FK safety).
  await prisma.guild.upsert({ where: { id: guildId }, create: { id: guildId }, update: {} });
  await prisma.user.upsert({
    where: { id: userId },
    create: { id: userId, username: "unknown" },
    update: {},
  });

  const row = await prisma.blacklist.upsert({
    where: { guildId_userId: { guildId, userId } },
    create: { guildId, userId, reason, addedById: "dashboard" },
    update: { reason },
  });

  await prisma.log.create({
    data: {
      guildId,
      category: "BLACKLIST",
      action: "BLACKLIST_ADD",
      message: `Dashboard blacklisted ${userId}`,
      actorId: "dashboard",
    },
  });

  return NextResponse.json({ row });
}

export async function DELETE(req: NextRequest) {
  const guildId = req.nextUrl.searchParams.get("guildId");
  const userId = req.nextUrl.searchParams.get("userId");
  if (!guildId || !userId) {
    return NextResponse.json({ error: "guildId and userId required" }, { status: 400 });
  }
  await prisma.blacklist
    .delete({ where: { guildId_userId: { guildId, userId } } })
    .catch(() => null);
  return NextResponse.json({ ok: true });
}
