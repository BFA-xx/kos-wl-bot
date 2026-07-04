import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, logAudit } from "@/lib/access";
import { OWNER_ROLE } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Transfer ownership to another member. Owner-only. The new owner is given the
 * Owner role; the previous owner is demoted to Admin (kept as a member).
 */
export async function POST(req: Request, { params }: { params: { org: string } }) {
  try {
    const { org, isOwner, user } = await requireOrgAccess(params.org);
    if (!isOwner) {
      return NextResponse.json({ error: "Only the owner can transfer ownership." }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const newOwnerId = String(body.userId ?? "").trim();
    if (!newOwnerId || newOwnerId === org.ownerId) {
      return NextResponse.json({ error: "Pick a different member." }, { status: 400 });
    }

    const target = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: org.id, userId: newOwnerId } },
    });
    if (!target) return NextResponse.json({ error: "That user isn't a member." }, { status: 400 });

    const [ownerRole, adminRole] = await Promise.all([
      prisma.organizationRole.findFirst({ where: { organizationId: org.id, name: OWNER_ROLE } }),
      prisma.organizationRole.findFirst({ where: { organizationId: org.id, name: "Admin" } }),
    ]);
    if (!ownerRole || !adminRole) {
      return NextResponse.json({ error: "Roles missing — contact support." }, { status: 500 });
    }

    await prisma.$transaction([
      prisma.organization.update({ where: { id: org.id }, data: { ownerId: newOwnerId } }),
      prisma.organizationMember.update({
        where: { organizationId_userId: { organizationId: org.id, userId: newOwnerId } },
        data: { roleId: ownerRole.id },
      }),
      prisma.organizationMember.update({
        where: { organizationId_userId: { organizationId: org.id, userId: org.ownerId } },
        data: { roleId: adminRole.id },
      }),
    ]);
    await logAudit(org.id, user.id, "OWNERSHIP_TRANSFER", { targetType: "user", targetId: newOwnerId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
