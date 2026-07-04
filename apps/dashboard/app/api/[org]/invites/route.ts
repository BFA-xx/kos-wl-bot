import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, logAudit } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Create a shareable invite link for a role. */
export async function POST(req: Request, { params }: { params: { org: string } }) {
  try {
    const { org, user } = await requireOrgAccess(params.org, PERMISSIONS.MEMBER_MANAGE);
    const body = await req.json().catch(() => ({}));
    const role = await prisma.organizationRole.findFirst({
      where: { id: String(body.roleId ?? ""), organizationId: org.id },
    });
    if (!role) return NextResponse.json({ error: "Unknown role." }, { status: 400 });
    if (role.name === "Owner") {
      return NextResponse.json({ error: "Can't invite to the Owner role." }, { status: 400 });
    }

    const token = randomBytes(24).toString("hex");
    await prisma.organizationInvite.create({
      data: {
        organizationId: org.id,
        discordUserId: body.discordUserId ? String(body.discordUserId) : null,
        roleId: role.id,
        token,
        invitedById: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    await logAudit(org.id, user.id, "INVITE_CREATE", { metadata: { role: role.name } });

    const base = process.env.DASHBOARD_URL || new URL(req.url).origin;
    return NextResponse.json({ token, url: `${base}/invite/${token}` });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
