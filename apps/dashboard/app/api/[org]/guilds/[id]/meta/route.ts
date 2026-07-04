import { NextResponse } from "next/server";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { fetchGuildChannels, fetchGuildRoles, hasBotToken } from "@/lib/discord-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Channels + roles for the New Raffle wizard. Needs DISCORD_BOT_TOKEN set. */
export async function GET(_req: Request, { params }: { params: { org: string; id: string } }) {
  try {
    const { guildIds } = await requireOrgAccess(params.org, PERMISSIONS.RAFFLE_CREATE);
    if (!guildIds.includes(params.id)) {
      return NextResponse.json({ error: "That server isn't connected to this org." }, { status: 403 });
    }
    if (!hasBotToken()) {
      // No bot token configured — the wizard falls back to manual IDs.
      return NextResponse.json({ channels: [], roles: [], hasBotToken: false });
    }
    const [channels, roles] = await Promise.all([
      fetchGuildChannels(params.id),
      fetchGuildRoles(params.id),
    ]);
    return NextResponse.json({ channels, roles, hasBotToken: true });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
