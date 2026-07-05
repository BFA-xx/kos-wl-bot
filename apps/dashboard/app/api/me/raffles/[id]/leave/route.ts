import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Leave a raffle (only while it's still LIVE), mirroring the bot's Leave. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = Number(params.id);
  const raffle = await prisma.raffle.findUnique({ where: { id }, select: { status: true, guildId: true } });
  if (!raffle) return NextResponse.json({ error: "Raffle not found." }, { status: 404 });
  if (raffle.status !== "LIVE") {
    return NextResponse.json({ error: "This raffle is closed — entries are locked." }, { status: 400 });
  }

  const existing = await prisma.participant.findUnique({
    where: { raffleId_userId: { raffleId: id, userId: user.id } },
  });
  if (!existing) return NextResponse.json({ ok: true, already: true });

  await prisma.$transaction([
    prisma.participant.delete({ where: { id: existing.id } }),
    prisma.raffle.update({ where: { id }, data: { entryCount: { decrement: 1 } } }),
  ]);
  await prisma.log
    .create({
      data: {
        guildId: raffle.guildId,
        raffleId: id,
        actorId: user.id,
        category: "ENTRY",
        action: "ENTRY_REMOVE",
        message: `${user.username} left raffle #${id} via the website`,
      },
    })
    .catch(() => undefined);

  return NextResponse.json({ ok: true });
}
