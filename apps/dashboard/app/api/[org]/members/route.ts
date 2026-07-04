import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, logAudit } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Add a member directly by Discord ID (they'll see the org on next login). */
export async function POST(req: Request, { params }: { params: { org: string } }) {
  try {
    const { org, user } = await requireOrgAccess(params.org, PERMISSIONS.MEMBER_MANAGE);
    const body = await req.json().catch(() => ({}));
    const discordUserId = String(body.discordUserId ?? "").trim();
    const roleId = String(body.roleId ?? "").trim();
    if (!/^\d{5,25}$/.test(discordUserId)) {
      return NextResponse.json({ error: "Enter a valid Discord user ID." }, { status: 400 });
    }

    const role = await prisma.organizationRole.findFirst({
      where: { id: roleId, organizationId: org.id },
    });
    if (!role) return NextResponse.json({ error: "Unknown role." }, { status: 400 });
    if (role.name === "Owner") {
      return NextResponse.json({ error: "Use Transfer ownership for the Owner role." }, { status: 400 });
    }

    // Ensure a User row exists (bot may already know them; else placeholder).
    await prisma.user.upsert({
      where: { id: discordUserId },
      create: { id: discordUserId, username: `user-${discordUserId.slice(-4)}` },
      update: {},
    });

    const existing = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: org.id, userId: discordUserId } },
    });
    if (existing) {
      return NextResponse.json({ error: "That user is already a member." }, { status: 409 });
    }

    await prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: discordUserId,
        roleId: role.id,
        status: "ACTIVE",
        invitedById: user.id,
      },
    });
    await logAudit(org.id, user.id, "MEMBER_ADD", { targetType: "user", targetId: discordUserId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
