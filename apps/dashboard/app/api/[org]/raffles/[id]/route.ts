import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess } from "@/lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { guildIds } = await requireOrgAccess(params.org);
    const id = Number(params.id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

    const raffle = await prisma.raffle.findFirst({
      where: { id, guildId: { in: guildIds } },
      include: {
        eligibleRoles: true,
        winners: { where: { replaced: false }, orderBy: { position: "asc" } },
        proof: true,
        _count: { select: { participants: true } },
      },
    });
    if (!raffle) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ raffle });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
