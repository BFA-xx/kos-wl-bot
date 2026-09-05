import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { parsePublicRaffleId } from "@/lib/raffle-share";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Queue publication of a held draw for the bot scheduler. */
export async function POST(
  _req: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.RAFFLE_END,
    );
    const id = parsePublicRaffleId(params.id);
    if (!id) {
      return NextResponse.json(
        { error: "Invalid raffle ID." },
        { status: 400 },
      );
    }

    const raffle = await prisma.raffle.findFirst({
      where: { id, guildId: { in: guildIds } },
      select: {
        id: true,
        status: true,
        holdResults: true,
        resultsPublishedAt: true,
        resultsPublishRequestedAt: true,
      },
    });
    if (!raffle) {
      return NextResponse.json({ error: "Raffle not found." }, { status: 404 });
    }
    if (raffle.status !== "ENDED") {
      return NextResponse.json(
        { error: "Raffle must be ended before publishing results." },
        { status: 400 },
      );
    }
    if (!raffle.holdResults) {
      return NextResponse.json(
        {
          error: "This raffle is configured to publish results automatically.",
        },
        { status: 400 },
      );
    }
    if (raffle.resultsPublishedAt) {
      return NextResponse.json({ ok: true, published: true });
    }
    if (raffle.resultsPublishRequestedAt) {
      return NextResponse.json({ ok: true, queued: true });
    }

    await prisma.raffle.update({
      where: { id },
      data: {
        resultsPublishRequestedAt: new Date(),
        resultsPublishRequestedBy: user.id,
      },
    });
    await logAudit(org.id, user.id, "RAFFLE_RESULTS_PUBLISH_REQUEST", {
      targetType: "raffle",
      targetId: String(id),
    });
    return NextResponse.json({ ok: true, queued: true });
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("raffle result publication failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
