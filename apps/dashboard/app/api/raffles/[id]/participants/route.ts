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

  const [count, raffle, rows] = await Promise.all([
    prisma.participant.count({ where: { raffleId: id } }),
    prisma.raffle.findUnique({ where: { id }, select: { status: true, spots: true } }),
    prisma.participant.findMany({
      where: { raffleId: id },
      orderBy: { enteredAt: "desc" },
      take: 500,
      select: { userId: true, username: true, enteredAt: true, flagged: true, flagReason: true },
    }),
  ]);

  return NextResponse.json({
    count,
    status: raffle?.status ?? null,
    spots: raffle?.spots ?? null,
    participants: rows,
  });
}
