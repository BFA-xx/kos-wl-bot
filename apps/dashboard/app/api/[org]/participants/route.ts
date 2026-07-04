import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Recent participants across all of the org's raffles. */
export async function GET(req: NextRequest, { params }: { params: { org: string } }) {
  try {
    const { guildIds } = await requireOrgAccess(params.org, PERMISSIONS.PARTICIPANT_VIEW);
    const q = req.nextUrl.searchParams.get("q")?.trim();

    const rows = await prisma.participant.findMany({
      where: {
        raffle: { guildId: { in: guildIds } },
        ...(q ? { username: { contains: q, mode: "insensitive" } } : {}),
      },
      orderBy: { enteredAt: "desc" },
      take: 500,
      select: {
        userId: true,
        username: true,
        enteredAt: true,
        flagged: true,
        flagReason: true,
        raffle: { select: { id: true, projectName: true } },
      },
    });

    const uniqueEntrants = new Set(rows.map((r) => r.userId)).size;
    return NextResponse.json({
      uniqueEntrants,
      participants: rows.map((r) => ({
        userId: r.userId,
        username: r.username,
        enteredAt: r.enteredAt,
        flagged: r.flagged,
        flagReason: r.flagReason,
        raffleId: r.raffle.id,
        project: r.raffle.projectName,
      })),
    });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
