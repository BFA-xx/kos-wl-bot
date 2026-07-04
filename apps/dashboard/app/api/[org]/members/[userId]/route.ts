import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, logAudit } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Change a member's role. */
export async function PATCH(
  req: Request,
  { params }: { params: { org: string; userId: string } },
) {
  try {
    const { org, user } = await requireOrgAccess(params.org, PERMISSIONS.MEMBER_MANAGE);
    if (params.userId === org.ownerId) {
      return NextResponse.json({ error: "The owner's role can't be changed here." }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));
    const role = await prisma.organizationRole.findFirst({
      where: { id: String(body.roleId ?? ""), organizationId: org.id },
    });
    if (!role) return NextResponse.json({ error: "Unknown role." }, { status: 400 });
    if (role.name === "Owner") {
      return NextResponse.json({ error: "Use Transfer ownership instead." }, { status: 400 });
    }

    await prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId: org.id, userId: params.userId } },
      data: { roleId: role.id },
    });
    await logAudit(org.id, user.id, "MEMBER_ROLE_CHANGE", {
      targetType: "user",
      targetId: params.userId,
      metadata: { role: role.name },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** Remove a member from the org. */
export async function DELETE(
  _req: Request,
  { params }: { params: { org: string; userId: string } },
) {
  try {
    const { org, user } = await requireOrgAccess(params.org, PERMISSIONS.MEMBER_MANAGE);
    if (params.userId === org.ownerId) {
      return NextResponse.json({ error: "The owner can't be removed. Transfer ownership first." }, { status: 400 });
    }
    await prisma.organizationMember
      .delete({ where: { organizationId_userId: { organizationId: org.id, userId: params.userId } } })
      .catch(() => null);
    await logAudit(org.id, user.id, "MEMBER_REMOVE", { targetType: "user", targetId: params.userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
