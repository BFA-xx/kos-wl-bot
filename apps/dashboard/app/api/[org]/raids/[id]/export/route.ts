import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org } = await requireOrgAccess(params.org, PERMISSIONS.RAID_EXPORT);
    const raid = await prisma.raid.findFirst({
      where: { id: params.id, organizationId: org.id },
      select: {
        id: true,
        title: true,
        participants: {
          orderBy: { createdAt: "asc" },
          select: {
            status: true,
            roleAssignedAt: true,
            roleAssignmentError: true,
            createdAt: true,
            updatedAt: true,
            user: {
              select: {
                id: true,
                username: true,
                globalName: true,
              },
            },
            submissions: {
              orderBy: { createdAt: "asc" },
              select: {
                status: true,
                proofKind: true,
                content: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });
    if (!raid)
      return NextResponse.json({ error: "Raid not found." }, { status: 404 });
    const csv = toCsv(
      [
        "Discord ID",
        "Member",
        "Status",
        "Submissions",
        "Latest proof type",
        "Latest proof",
        "Joined",
        "Last updated",
        "Role assigned",
        "Assignment error",
      ],
      raid.participants.map((participant) => {
        const latest = participant.submissions.at(-1);
        return [
          participant.user.id,
          participant.user.globalName ?? participant.user.username,
          participant.status,
          participant.submissions.length,
          latest?.proofKind ?? "",
          latest?.content ?? "",
          participant.createdAt.toISOString(),
          participant.updatedAt.toISOString(),
          participant.roleAssignedAt?.toISOString() ?? "",
          participant.roleAssignmentError ?? "",
        ];
      }),
    );
    const safeName = raid.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 60);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${safeName || "raid"}-participants.csv"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("raid export failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
