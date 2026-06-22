import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const raffle = await prisma.raffle.findUnique({
    where: { id },
    include: {
      eligibleRoles: true,
      winners: { where: { replaced: false }, orderBy: { position: "asc" } },
      proof: true,
      _count: { select: { participants: true } },
    },
  });
  if (!raffle) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ raffle });
}
