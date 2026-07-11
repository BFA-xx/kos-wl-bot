import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Queue a cancelled raffle for the EC2 bot to publish again. */
export async function POST(
  _req: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.RAFFLE_EDIT,
    );
    const id = Number(params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return NextResponse.json({ error: "Invalid raffle id." }, { status: 400 });
    }

    const raffle = await prisma.raffle.findFirst({
      where: { id, guildId: { in: guildIds } },
      select: {
        id: true,
        status: true,
        channelId: true,
        endAt: true,
      },
    });
    if (!raffle) {
      return NextResponse.json({ error: "Raffle not found." }, { status: 404 });
    }
    if (raffle.status !== "CANCELLED") {
      return NextResponse.json(
        { error: "Only cancelled raffles need to be reposted." },
        { status: 409 },
      );
    }
    if (!raffle.channelId) {
      return NextResponse.json(
        { error: "Configure a raffle channel before reposting." },
        { status: 400 },
      );
    }
    if (raffle.endAt.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "This raffle has already expired. Duplicate it with new dates instead." },
        { status: 400 },
      );
    }

    await prisma.raffle.update({
      where: { id },
      data: {
        status: "DRAFT",
        messageId: null,
        startPinged: false,
      },
    });
    await logAudit(org.id, user.id, "RAFFLE_REPOST_QUEUED", {
      targetType: "raffle",
      targetId: String(id),
    });

    return NextResponse.json({ ok: true, status: "DRAFT" });
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("raffle repost queue failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
