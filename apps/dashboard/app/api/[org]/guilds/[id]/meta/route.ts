import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { fetchGuildChannels, fetchGuildRoles, hasBotToken } from "@/lib/discord-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Channels + roles for the New Raffle wizard. Needs DISCORD_BOT_TOKEN set. */
export async function GET(_req: Request, { params }: { params: { org: string; id: string } }) {
  try {
    const { guildIds } = await requireOrgAccess(params.org);
    if (!guildIds.includes(params.id)) {
      return NextResponse.json({ error: "That server isn't connected to this org." }, { status: 403 });
    }
    const guild = await prisma.guild.findUnique({
      where: { id: params.id },
      select: {
        defaultRaffleChannelId: true,
        defaultAnnounceChannelId: true,
        defaultProofChannelId: true,
        defaultPointsChannelId: true,
      },
    });
    const defaults = {
      raffleChannelId: guild?.defaultRaffleChannelId ?? null,
      announceChannelId: guild?.defaultAnnounceChannelId ?? null,
      proofChannelId: guild?.defaultProofChannelId ?? null,
      pointsChannelId: guild?.defaultPointsChannelId ?? null,
    };
    if (!hasBotToken()) {
      // No bot token configured — the wizard falls back to manual IDs.
      return NextResponse.json({ channels: [], roles: [], hasBotToken: false, defaults });
    }
    const [channels, roles] = await Promise.all([
      fetchGuildChannels(params.id),
      fetchGuildRoles(params.id),
    ]);
    return NextResponse.json({ channels, roles, hasBotToken: true, defaults });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
