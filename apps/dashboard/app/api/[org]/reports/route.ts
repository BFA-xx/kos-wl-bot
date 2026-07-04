import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Completed raffles with their proof metadata. The proof files live on the bot
 * host, so we expose the Discord message link + regenerable CSV/XLSX exports
 * (via the export routes) rather than raw file paths.
 */
export async function GET(_req: Request, { params }: { params: { org: string } }) {
  try {
    const { guildIds } = await requireOrgAccess(params.org, PERMISSIONS.REPORT_VIEW);

    const raffles = await prisma.raffle.findMany({
      where: { guildId: { in: guildIds }, status: "ENDED" },
      orderBy: { endedAt: "desc" },
      take: 200,
      select: {
        id: true,
        projectName: true,
        title: true,
        spots: true,
        entryCount: true,
        endedAt: true,
        drawnAt: true,
        drawSeedHash: true,
        proof: { select: { messageLink: true, generatedAt: true } },
        _count: { select: { winners: { where: { replaced: false } } } },
      },
    });

    return NextResponse.json({
      reports: raffles.map((r) => ({
        id: r.id,
        projectName: r.projectName,
        title: r.title,
        spots: r.spots,
        entryCount: r.entryCount,
        winners: r._count.winners,
        endedAt: r.endedAt,
        drawnAt: r.drawnAt,
        verified: Boolean(r.drawSeedHash),
        messageLink: r.proof?.messageLink ?? null,
        hasProof: Boolean(r.proof),
      })),
    });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
