import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { removeWebEntry } from "@/lib/raffle-entry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Leave a raffle (only while it's still LIVE), mirroring the bot's Leave. */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = Number(params.id);
  const raffle = await prisma.raffle.findUnique({
    where: { id },
    select: { id: true, status: true, guildId: true },
  });
  if (!raffle)
    return NextResponse.json({ error: "Raffle not found." }, { status: 404 });
  if (raffle.status !== "LIVE") {
    return NextResponse.json(
      { error: "This raffle is closed — entries are locked." },
      { status: 400 },
    );
  }

  const outcome = await removeWebEntry(user, raffle, "website");
  if (outcome === "absent")
    return NextResponse.json({ ok: true, already: true });

  return NextResponse.json({ ok: true });
}
