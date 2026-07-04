import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireUser, logAudit } from "@/lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Accept an invite as the signed-in user. */
export async function POST(_req: Request, { params }: { params: { token: string } }) {
  try {
    const user = await requireUser();
    const invite = await prisma.organizationInvite.findUnique({
      where: { token: params.token },
      include: { organization: { select: { slug: true } } },
    });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      return NextResponse.json({ error: "This invite is invalid or expired." }, { status: 410 });
    }
    if (invite.discordUserId && invite.discordUserId !== user.id) {
      return NextResponse.json({ error: "This invite is for a different Discord account." }, { status: 403 });
    }

    const existing = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: invite.organizationId, userId: user.id } },
    });
    if (!existing) {
      await prisma.organizationMember.create({
        data: {
          organizationId: invite.organizationId,
          userId: user.id,
          roleId: invite.roleId,
          status: "ACTIVE",
          invitedById: invite.invitedById,
        },
      });
    }
    await prisma.organizationInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });
    await logAudit(invite.organizationId, user.id, "INVITE_ACCEPT", { targetType: "user", targetId: user.id });

    return NextResponse.json({ ok: true, slug: invite.organization.slug });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
