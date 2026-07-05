import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { evaluateWebGates } from "@/lib/raffle-entry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Raffle info + this user's entry state + gate checklist, for the web page. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const raffle = await prisma.raffle.findUnique({
    where: { id },
    include: { eligibleRoles: true },
  });
  if (!raffle) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [entered, report] = await Promise.all([
    prisma.participant.findUnique({
      where: { raffleId_userId: { raffleId: id, userId: user.id } },
      select: { enteredAt: true },
    }),
    raffle.status === "LIVE"
      ? evaluateWebGates(user, raffle)
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    status: raffle.status,
    entered: Boolean(entered),
    enteredAt: entered?.enteredAt ?? null,
    entryCount: raffle.hideEntries ? null : raffle.entryCount,
    spots: raffle.spots,
    endAt: raffle.endAt,
    startAt: raffle.startAt,
    gates: report?.gates ?? [],
    canEnter: report?.canEnter ?? false,
    discordOnly: report?.discordOnly ?? false,
  });
}
