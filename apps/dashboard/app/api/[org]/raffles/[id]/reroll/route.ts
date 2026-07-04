import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, logAudit } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Request a reroll. DB-mediated: we write the request to the raffle and the
 * bot's scheduler picks it up (the dashboard can't reach the bot directly).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(params.org, PERMISSIONS.RAFFLE_REROLL);
    const id = Number(params.id);

    const raffle = await prisma.raffle.findFirst({
      where: { id, guildId: { in: guildIds } },
      select: { id: true, status: true },
    });
    if (!raffle) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (raffle.status !== "ENDED") {
      return NextResponse.json({ error: "Raffle must be ended before rerolling." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    await prisma.raffle.update({
      where: { id },
      data: {
        rerollRequest: {
          mode: body.mode ?? "all",
          count: body.count,
          userIds: body.userIds,
          actorId: user.id,
        },
        rerollRequestedAt: new Date(),
      },
    });
    await logAudit(org.id, user.id, "RAFFLE_REROLL", { targetType: "raffle", targetId: String(id) });
    return NextResponse.json({ ok: true, queued: true });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
