import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { getValidAccessToken } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { fetchManageableGuilds, guildIconUrl, botInviteUrl } from "@/lib/discord-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** List the user's manageable Discord servers, flagged by connection status. */
export async function GET(_req: Request, { params }: { params: { org: string } }) {
  try {
    const { org, user } = await requireOrgAccess(params.org, PERMISSIONS.GUILD_CONNECT);
    const token = await getValidAccessToken(user.id);
    if (!token) {
      return NextResponse.json({ error: "reconnect_discord" }, { status: 401 });
    }

    const guilds = await fetchManageableGuilds(token);
    const anyConnected = await prisma.guildConnection.findMany({
      where: { guildId: { in: guilds.map((g) => g.id) } },
      select: { guildId: true, organizationId: true },
    });
    const byGuild = new Map(anyConnected.map((c) => [c.guildId, c.organizationId]));

    const list = guilds.map((g) => ({
      id: g.id,
      name: g.name,
      icon: guildIconUrl(g),
      owner: g.owner,
      connectedHere: byGuild.get(g.id) === org.id,
      connectedElsewhere: byGuild.has(g.id) && byGuild.get(g.id) !== org.id,
    }));

    // The org's current connections (may include servers this user doesn't manage).
    const conns = await prisma.guildConnection.findMany({
      where: { organizationId: org.id },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    const names = await prisma.guild.findMany({
      where: { id: { in: conns.map((c) => c.guildId) } },
      select: {
        id: true,
        name: true,
        iconUrl: true,
        defaultRaffleChannelId: true,
        defaultAnnounceChannelId: true,
        defaultProofChannelId: true,
        defaultPointsChannelId: true,
      },
    });
    const nameMap = new Map(names.map((n) => [n.id, n]));
    const connected = conns.map((c) => ({
      id: c.id,
      guildId: c.guildId,
      name: nameMap.get(c.guildId)?.name ?? c.guildId,
      icon: nameMap.get(c.guildId)?.iconUrl ?? null,
      isPrimary: c.isPrimary,
      defaultRaffleChannelId:
        nameMap.get(c.guildId)?.defaultRaffleChannelId ?? null,
      defaultAnnounceChannelId:
        nameMap.get(c.guildId)?.defaultAnnounceChannelId ?? null,
      defaultProofChannelId:
        nameMap.get(c.guildId)?.defaultProofChannelId ?? null,
      defaultPointsChannelId:
        nameMap.get(c.guildId)?.defaultPointsChannelId ?? null,
    }));

    return NextResponse.json({ guilds: list, connected, inviteBase: botInviteUrl() });
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("guilds list failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
