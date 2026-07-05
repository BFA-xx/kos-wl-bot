import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The notification feed: personal rows (wins, results) merged with active
 * announcements (global + orgs the user belongs to or has entered raffles in).
 * Announcements are merged at read time — no per-user fan-out rows.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Orgs the user is connected to: memberships + raffle participation.
  const [memberships, participated] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { userId: user.id },
      select: { organizationId: true },
    }),
    prisma.participant.findMany({
      where: { userId: user.id },
      select: { raffle: { select: { guildId: true } } },
      distinct: ["raffleId"],
      take: 500,
    }),
  ]);
  const guildIds = [...new Set(participated.map((p) => p.raffle.guildId))];
  const connections = guildIds.length
    ? await prisma.guildConnection.findMany({
        where: { guildId: { in: guildIds } },
        select: { organizationId: true },
      })
    : [];
  const orgIds = [
    ...new Set([
      ...memberships.map((m) => m.organizationId),
      ...connections.map((c) => c.organizationId),
    ]),
  ];

  const [personal, announcements] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.announcement.findMany({
      where: {
        active: true,
        OR: [{ organizationId: null }, { organizationId: { in: orgIds } }],
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const seenAt = user.notificationsSeenAt?.getTime() ?? 0;
  const items = [
    ...personal.map((n) => ({
      id: n.id,
      kind: "personal" as const,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      unread: !n.readAt,
      createdAt: n.createdAt,
    })),
    ...announcements.map((a) => ({
      id: `anno-${a.id}`,
      kind: "announcement" as const,
      type: a.level,
      title: a.title,
      body: a.body,
      link: null as string | null,
      unread: a.createdAt.getTime() > seenAt,
      createdAt: a.createdAt,
    })),
  ].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());

  return NextResponse.json({
    items: items.slice(0, 40),
    unread: items.filter((i) => i.unread).length,
  });
}

/** Mark everything read. */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await Promise.all([
    prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { notificationsSeenAt: new Date() },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
