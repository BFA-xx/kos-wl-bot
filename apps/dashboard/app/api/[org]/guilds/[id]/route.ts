import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, logAudit } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Disconnect a Discord server from the org (by GuildConnection id). */
export async function DELETE(
  _req: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user } = await requireOrgAccess(params.org, PERMISSIONS.GUILD_CONNECT);
    const conn = await prisma.guildConnection.findUnique({ where: { id: params.id } });
    if (!conn || conn.organizationId !== org.id) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    await prisma.guildConnection.delete({ where: { id: params.id } });
    await logAudit(org.id, user.id, "GUILD_DISCONNECT", {
      targetType: "guild",
      targetId: conn.guildId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("guild disconnect failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
