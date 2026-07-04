import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess } from "@/lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Members + roles + pending invites for the Team page. */
export async function GET(_req: Request, { params }: { params: { org: string } }) {
  try {
    const { org, isOwner, permissions } = await requireOrgAccess(params.org);

    const [members, roles, invites] = await Promise.all([
      prisma.organizationMember.findMany({
        where: { organizationId: org.id },
        include: { user: true, role: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.organizationRole.findMany({
        where: { organizationId: org.id },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, isSystem: true, permissions: true },
      }),
      prisma.organizationInvite.findMany({
        where: { organizationId: org.id, acceptedAt: null, expiresAt: { gt: new Date() } },
        include: { role: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return NextResponse.json({
      ownerId: org.ownerId,
      viewer: { isOwner, permissions },
      members: members.map((m) => ({
        userId: m.userId,
        name: m.user.globalName ?? m.user.username,
        avatarUrl: m.user.avatarUrl,
        roleId: m.roleId,
        roleName: m.role.name,
        status: m.status,
        isOwner: m.userId === org.ownerId,
        joinedAt: m.createdAt,
      })),
      roles,
      invites: invites.map((i) => ({
        id: i.id,
        token: i.token,
        discordUserId: i.discordUserId,
        roleName: i.role.name,
        expiresAt: i.expiresAt,
      })),
    });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
