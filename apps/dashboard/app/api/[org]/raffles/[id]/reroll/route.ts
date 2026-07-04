import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { callBot } from "@/lib/bot";
import { AccessError, requireOrgAccess, logAudit } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(params.org, PERMISSIONS.RAFFLE_REROLL);
    const id = Number(params.id);

    const raffle = await prisma.raffle.findFirst({
      where: { id, guildId: { in: guildIds } },
      select: { id: true },
    });
    if (!raffle) return NextResponse.json({ error: "not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const result = await callBot(`/internal/raffles/${id}/reroll`, {
      mode: body.mode ?? "all",
      userIds: body.userIds,
      count: body.count,
      actorId: user.id,
    });
    await logAudit(org.id, user.id, "RAFFLE_REROLL", { targetType: "raffle", targetId: String(id) });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
