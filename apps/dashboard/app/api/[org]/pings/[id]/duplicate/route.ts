import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user } = await requireOrgAccess(
      params.org,
      PERMISSIONS.PING_CREATE,
    );
    const source = await prisma.ping.findFirst({
      where: { id: params.id, organizationId: org.id },
    });
    if (!source)
      return NextResponse.json({ error: "Ping not found." }, { status: 404 });
    const duplicate = await prisma.ping.create({
      data: {
        organizationId: source.organizationId,
        guildId: source.guildId,
        title: `Copy of ${source.title}`.slice(0, 120),
        message: source.message,
        channelId: source.channelId,
        mentionMode: source.mentionMode,
        roleIds: source.roleIds,
        linkUrl: source.linkUrl,
        scheduledAt: null,
        createdById: user.id,
      },
    });
    await logAudit(org.id, user.id, "PING_DUPLICATE", {
      targetType: "ping",
      targetId: duplicate.id,
      metadata: { sourcePingId: source.id },
    });
    return NextResponse.json({ ok: true, id: duplicate.id });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("ping duplicate failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
