import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1_000;

export async function GET(
  req: Request,
  { params }: { params: { org: string } },
) {
  const configuredToken = process.env.SHEETS_SYNC_TOKEN?.trim() ?? "";
  if (configuredToken.length < 32) {
    return NextResponse.json(
      { error: "member_sync_not_configured" },
      { status: 503 },
    );
  }
  if (!authorized(req.headers.get("authorization"), configuredToken)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const organization = await prisma.organization.findUnique({
    where: { slug: params.org },
    select: {
      id: true,
      slug: true,
      name: true,
      suspendedAt: true,
      guildConnections: {
        where: { ownershipVerified: true },
        select: { guildId: true },
      },
    },
  });
  if (!organization) {
    return NextResponse.json(
      { error: "organization_not_found" },
      { status: 404 },
    );
  }
  if (organization.suspendedAt) {
    return NextResponse.json(
      { error: "organization_suspended" },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const page = positiveInteger(url.searchParams.get("page"), 1);
  const limit = Math.min(
    positiveInteger(url.searchParams.get("limit"), DEFAULT_LIMIT),
    MAX_LIMIT,
  );
  const requestedStatus = url.searchParams.get("status")?.toLowerCase();
  const status =
    requestedStatus === "active" || requestedStatus === "left"
      ? requestedStatus
      : "all";
  const guildIds = organization.guildConnections.map(({ guildId }) => guildId);
  const where = {
    guildId: { in: guildIds },
    ...(status === "all" ? {} : { isActive: status === "active" }),
  };

  const [total, records] =
    guildIds.length === 0
      ? [0, []]
      : await prisma.$transaction([
          prisma.discordGuildMember.count({ where }),
          prisma.discordGuildMember.findMany({
            where,
            orderBy: [
              { username: "asc" },
              { userId: "asc" },
              { guildId: "asc" },
            ],
            skip: (page - 1) * limit,
            take: limit,
            select: {
              guildId: true,
              userId: true,
              username: true,
              globalName: true,
              nickname: true,
              displayName: true,
              avatarUrl: true,
              joinedAt: true,
              firstSeenAt: true,
              lastSeenAt: true,
              leftAt: true,
              isActive: true,
              guild: { select: { name: true } },
            },
          }),
        ]);

  const hasMore = page * limit < total;
  return NextResponse.json(
    {
      version: 1,
      organization: {
        slug: organization.slug,
        name: organization.name,
      },
      page,
      limit,
      total,
      hasMore,
      nextPage: hasMore ? page + 1 : null,
      syncedAt: new Date().toISOString(),
      members: records.map(({ guild, ...member }) => ({
        ...member,
        guildName: guild.name ?? member.guildId,
        status: member.isActive ? "Active" : "Left",
      })),
    },
    {
      headers: {
        "cache-control": "private, no-store, max-age=0",
      },
    },
  );
}

function authorized(header: string | null, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7), "utf8");
  const expected = Buffer.from(token, "utf8");
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
