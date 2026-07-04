import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, logAudit } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Revoke a pending invite link. */
export async function DELETE(
  _req: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user } = await requireOrgAccess(params.org, PERMISSIONS.MEMBER_MANAGE);
    const invite = await prisma.organizationInvite.findUnique({ where: { id: params.id } });
    if (!invite || invite.organizationId !== org.id) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    await prisma.organizationInvite.delete({ where: { id: params.id } });
    await logAudit(org.id, user.id, "INVITE_REVOKE", { targetType: "invite", targetId: params.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
