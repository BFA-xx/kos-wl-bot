import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { evaluateWebGates, fetchGuildMember, recordWebEntry } from "@/lib/raffle-entry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Enter a raffle from the website. Enforces every gate the bot enforces. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = Number(params.id);
  const raffle = await prisma.raffle.findUnique({
    where: { id },
    include: { eligibleRoles: true },
  });
  if (!raffle) return NextResponse.json({ error: "Raffle not found." }, { status: 404 });
  if (raffle.status !== "LIVE") {
    return NextResponse.json({ error: "This raffle is not open for entries." }, { status: 400 });
  }

  const existing = await prisma.participant.findUnique({
    where: { raffleId_userId: { raffleId: id, userId: user.id } },
  });
  if (existing) return NextResponse.json({ ok: true, already: true });

  const report = await evaluateWebGates(user, raffle);
  if (!report.canEnter) {
    return NextResponse.json(
      { error: "requirements", gates: report.gates, discordOnly: report.discordOnly },
      { status: 403 },
    );
  }

  // Re-fetch the member for the entry snapshot (roles/join date).
  const member = await fetchGuildMember(raffle.guildId, user.id);
  if (member === "not_member" || member === "unavailable") {
    return NextResponse.json({ error: "Couldn't confirm your Discord membership." }, { status: 409 });
  }

  try {
    const entryCount = await recordWebEntry(user, raffle, member);
    return NextResponse.json({ ok: true, entryCount });
  } catch (err) {
    // Unique violation = raced duplicate — treat as already entered.
    if ((err as { code?: string }).code === "P2002") {
      return NextResponse.json({ ok: true, already: true });
    }
    console.error("web entry failed", err);
    return NextResponse.json({ error: "Entry failed — try again." }, { status: 500 });
  }
}
