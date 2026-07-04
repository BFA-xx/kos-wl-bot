import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { guildIds } = await requireOrgAccess(params.org, PERMISSIONS.PARTICIPANT_VIEW);
    const id = Number(params.id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

    // Ensure the raffle is in this org before returning its participants.
    const raffle = await prisma.raffle.findFirst({
      where: { id, guildId: { in: guildIds } },
      select: { status: true, spots: true },
    });
    if (!raffle) return NextResponse.json({ error: "not found" }, { status: 404 });

    const [count, rows] = await Promise.all([
      prisma.participant.count({ where: { raffleId: id } }),
      prisma.participant.findMany({
        where: { raffleId: id },
        orderBy: { enteredAt: "desc" },
        take: 500,
        select: { userId: true, username: true, enteredAt: true, flagged: true, flagReason: true },
      }),
    ]);

    return NextResponse.json({ count, status: raffle.status, spots: raffle.spots, participants: rows });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
