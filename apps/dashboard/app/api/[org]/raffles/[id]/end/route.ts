import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, logAudit } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * End a raffle now. DB-mediated: we set endAt to now; the bot's scheduler
 * closes LIVE raffles whose end time has passed and draws winners.
 */
export async function POST(
  _req: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(params.org, PERMISSIONS.RAFFLE_END);
    const id = Number(params.id);

    const raffle = await prisma.raffle.findFirst({
      where: { id, guildId: { in: guildIds } },
      select: { id: true, status: true },
    });
    if (!raffle) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (raffle.status !== "LIVE" && raffle.status !== "UPCOMING") {
      return NextResponse.json({ error: "Raffle isn't running." }, { status: 400 });
    }

    // Force it live and ended-now so the next scheduler tick draws winners.
    await prisma.raffle.update({
      where: { id },
      data: { status: "LIVE", endAt: new Date() },
    });
    await logAudit(org.id, user.id, "RAFFLE_END", { targetType: "raffle", targetId: String(id) });
    return NextResponse.json({ ok: true, queued: true });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
