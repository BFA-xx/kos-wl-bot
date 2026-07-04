import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, logAudit } from "@/lib/access";
import { getValidAccessToken } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import {
  fetchManageableGuilds,
  guildIconUrl,
  botIsInGuild,
  botInviteUrl,
} from "@/lib/discord-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Connect a Discord server to the org. Verifies (a) the user owns/manages the
 * guild, (b) the bot is present, then records a GuildConnection. This is the
 * "Verify ownership → Save Guild ID" step of the linking flow.
 */
export async function POST(req: Request, { params }: { params: { org: string } }) {
  try {
    const { org, user } = await requireOrgAccess(params.org, PERMISSIONS.GUILD_CONNECT);
    const body = await req.json().catch(() => ({}));
    const guildId = String(body.guildId ?? "").trim();
    if (!guildId) return NextResponse.json({ error: "guildId required" }, { status: 400 });

    const token = await getValidAccessToken(user.id);
    if (!token) return NextResponse.json({ error: "reconnect_discord" }, { status: 401 });

    // (a) Ownership / MANAGE_GUILD check.
    const manageable = await fetchManageableGuilds(token);
    const g = manageable.find((x) => x.id === guildId);
    if (!g) {
      return NextResponse.json(
        { error: "You don't own or manage that server." },
        { status: 403 },
      );
    }

    // A guild can only belong to one org.
    const existing = await prisma.guildConnection.findUnique({ where: { guildId } });
    if (existing && existing.organizationId !== org.id) {
      return NextResponse.json(
        { error: "That server is already connected to another organization." },
        { status: 409 },
      );
    }
    if (existing) return NextResponse.json({ ok: true, alreadyConnected: true });

    // (b) Bot presence check — only when a bot token is configured. Without it
    // we can't verify, so we trust the user invited the bot (the UI shows the
    // invite link) rather than block onboarding entirely.
    const botToken = process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN;
    if (botToken && !(await botIsInGuild(guildId))) {
      return NextResponse.json(
        { error: "bot_not_in_server", inviteUrl: botInviteUrl(guildId) },
        { status: 409 },
      );
    }

    // Ensure the bot's Guild config row exists (harmless if the bot made it).
    await prisma.guild.upsert({
      where: { id: guildId },
      create: { id: guildId, name: g.name, iconUrl: guildIconUrl(g) },
      update: { name: g.name, iconUrl: guildIconUrl(g) },
    });

    const count = await prisma.guildConnection.count({
      where: { organizationId: org.id },
    });
    await prisma.guildConnection.create({
      data: {
        organizationId: org.id,
        guildId,
        connectedById: user.id,
        ownershipVerified: true,
        isPrimary: count === 0,
      },
    });
    await logAudit(org.id, user.id, "GUILD_CONNECT", {
      targetType: "guild",
      targetId: guildId,
      metadata: { name: g.name },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("guild connect failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
