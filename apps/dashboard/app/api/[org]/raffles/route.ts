import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, guildScope } from "@/lib/access";
import type { RaffleStatus } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { org: string } }) {
  try {
    const { guildIds } = await requireOrgAccess(params.org);
    const status = req.nextUrl.searchParams.get("status");
    const raffles = await prisma.raffle.findMany({
      where: {
        ...guildScope(guildIds),
        ...(status ? { status: status as RaffleStatus } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ raffles });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
