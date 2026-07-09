import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, logAudit } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const channelId = (value: unknown) => {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) return null;
  if (!/^\d{5,25}$/.test(id)) return undefined;
  return id;
};

/** Configure per-server dashboard defaults for new raffles. */
export async function PATCH(
  req: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.SETTINGS_EDIT,
    );
    if (!guildIds.includes(params.id)) {
      return NextResponse.json(
        { error: "That server isn't connected to this org." },
        { status: 403 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const raffleChannelId = channelId(body.raffleChannelId);
    const announceChannelId = channelId(body.announceChannelId);
    const proofChannelId = channelId(body.proofChannelId);
    if (
      raffleChannelId === undefined ||
      announceChannelId === undefined ||
      proofChannelId === undefined
    ) {
      return NextResponse.json(
        { error: "Pick valid Discord channels." },
        { status: 400 },
      );
    }

    await prisma.guild.update({
      where: { id: params.id },
      data: {
        defaultRaffleChannelId: raffleChannelId,
        defaultAnnounceChannelId: announceChannelId,
        defaultProofChannelId: proofChannelId,
      },
    });
    await logAudit(org.id, user.id, "GUILD_DEFAULT_CHANNELS_UPDATE", {
      targetType: "guild",
      targetId: params.id,
      metadata: {
        raffleChannelId,
        announceChannelId,
        proofChannelId,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("guild defaults update failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
