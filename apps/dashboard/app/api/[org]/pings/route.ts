import { NextResponse } from "next/server";
import { PingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { parsePingInput } from "@/lib/ping-input";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: { org: string } },
) {
  try {
    const { org, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.PING_VIEW,
    );
    const [pings, guilds] = await Promise.all([
      prisma.ping.findMany({
        where: { organizationId: org.id },
        orderBy: [{ createdAt: "desc" }],
        take: 100,
        include: { guild: { select: { id: true, name: true } } },
      }),
      prisma.guild.findMany({
        where: { id: { in: guildIds } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);
    return NextResponse.json({ pings, guilds });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("ping list failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { org: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.PING_CREATE,
    );
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const input = parsePingInput(body);
    if ("error" in input)
      return NextResponse.json({ error: input.error }, { status: 400 });
    if (!guildIds.includes(input.guildId))
      return NextResponse.json(
        { error: "That Discord server is not connected to this organization." },
        { status: 403 },
      );
    const publish = body.publish === true;
    const ping = await prisma.ping.create({
      data: {
        organizationId: org.id,
        ...input,
        status: publish ? PingStatus.SCHEDULED : PingStatus.DRAFT,
        scheduledAt: publish
          ? normalizeScheduledAt(input.scheduledAt)
          : input.scheduledAt,
        createdById: user.id,
      },
    });
    await logAudit(org.id, user.id, "PING_CREATE", {
      targetType: "ping",
      targetId: ping.id,
      metadata: {
        status: ping.status,
        guildId: ping.guildId,
        mentionMode: ping.mentionMode,
      },
    });
    return NextResponse.json({ ok: true, id: ping.id, status: ping.status });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("ping create failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function normalizeScheduledAt(value: Date | null): Date {
  const now = new Date();
  return value && value > now ? value : now;
}
