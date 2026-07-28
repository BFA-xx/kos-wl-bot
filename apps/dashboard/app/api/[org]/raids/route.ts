import { NextResponse } from "next/server";
import { RaidStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { parseRaidInput } from "@/lib/raid-input";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: { org: string } },
) {
  try {
    const { org, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.RAID_VIEW,
    );
    const selectedRaidId = new URL(request.url).searchParams.get("raidId");
    const [raids, guilds] = await Promise.all([
      prisma.raid.findMany({
        where: { organizationId: org.id },
        orderBy: [{ createdAt: "desc" }],
        take: 100,
        include: {
          guild: { select: { id: true, name: true } },
          _count: { select: { participants: true, submissions: true } },
        },
      }),
      prisma.guild.findMany({
        where: { id: { in: guildIds } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);
    const ids = raids.map((raid) => raid.id);
    const grouped = ids.length
      ? await prisma.raidSubmission.groupBy({
          by: ["raidId", "status"],
          where: { raidId: { in: ids } },
          _count: { _all: true },
        })
      : [];
    const submissionCounts = new Map<string, Record<string, number>>();
    for (const row of grouped) {
      const counts = submissionCounts.get(row.raidId) ?? {};
      counts[row.status] = row._count._all;
      submissionCounts.set(row.raidId, counts);
    }

    let participants = null;
    if (selectedRaidId) {
      const selected = raids.find((raid) => raid.id === selectedRaidId);
      if (!selected)
        return NextResponse.json({ error: "Raid not found." }, { status: 404 });
      participants = await prisma.raidParticipant.findMany({
        where: { raidId: selectedRaidId },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        include: {
          user: {
            select: {
              id: true,
              username: true,
              globalName: true,
              avatarUrl: true,
            },
          },
          submissions: {
            orderBy: [{ createdAt: "desc" }],
            include: {
              attachments: {
                select: {
                  id: true,
                  fileName: true,
                  contentType: true,
                  byteLength: true,
                },
              },
            },
          },
        },
      });
    }

    return NextResponse.json({
      raids: raids.map((raid) => ({
        ...raid,
        participantCount: raid._count.participants,
        submissionCount: raid._count.submissions,
        submissionCounts: submissionCounts.get(raid.id) ?? {},
        _count: undefined,
      })),
      participants,
      guilds,
    });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("raid list failed", err);
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
      PERMISSIONS.RAID_CREATE,
    );
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const requestedGuildId = String(body.guildId ?? "").trim();
    if (!/^\d{5,25}$/u.test(requestedGuildId))
      return NextResponse.json(
        { error: "Select a Discord server." },
        { status: 400 },
      );
    if (!guildIds.includes(requestedGuildId))
      return NextResponse.json(
        { error: "That Discord server is not connected to this organization." },
        { status: 403 },
      );
    const requestedChannelId = String(body.channelId ?? "").trim();
    const guildDefaults = requestedChannelId
      ? null
      : await prisma.guild.findUnique({
          where: { id: requestedGuildId },
          select: { defaultRaidChannelId: true },
        });
    const input = parseRaidInput({
      ...body,
      channelId:
        requestedChannelId || guildDefaults?.defaultRaidChannelId || "",
    });
    if ("error" in input)
      return NextResponse.json({ error: input.error }, { status: 400 });
    if (body.publish === true && input.endAt <= new Date())
      return NextResponse.json(
        { error: "A published raid must end in the future." },
        { status: 400 },
      );

    const raid = await prisma.raid.create({
      data: {
        organizationId: org.id,
        ...input,
        status: body.publish === true ? RaidStatus.SCHEDULED : RaidStatus.DRAFT,
        createdById: user.id,
      },
    });
    await logAudit(org.id, user.id, "RAID_CREATE", {
      targetType: "raid",
      targetId: raid.id,
      metadata: {
        status: raid.status,
        guildId: raid.guildId,
        proofType: raid.proofType,
      },
    });
    return NextResponse.json({
      ok: true,
      id: raid.id,
      status: raid.status,
    });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("raid create failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
