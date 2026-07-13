import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logAudit, requireOrgAccess, withAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { isCollabStatus } from "@/lib/collab-shared";

export const PATCH = withAccess(async (req, { params }) => {
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids)
    ? [
        ...new Set<string>(
          body.ids.filter(
            (id: unknown): id is string => typeof id === "string",
          ),
        ),
      ].slice(0, 100)
    : [];
  if (!ids.length)
    return NextResponse.json(
      { error: "Select at least one collaboration." },
      { status: 400 },
    );
  const archive = body.action === "archive";
  const access = await requireOrgAccess(
    params.org,
    archive ? PERMISSIONS.COLLAB_ARCHIVE : PERMISSIONS.COLLAB_EDIT,
  );
  const data = archive
    ? { archivedAt: new Date(), lastActivityAt: new Date() }
    : isCollabStatus(body.status)
      ? {
          status: body.status,
          lastActivityAt: new Date(),
          ...(body.status === "COMPLETED" ? { completedAt: new Date() } : {}),
          ...(body.status === "CANCELLED" ? { cancelledAt: new Date() } : {}),
        }
      : null;
  if (!data)
    return NextResponse.json(
      { error: "Choose a valid bulk action." },
      { status: 400 },
    );
  const result = await prisma.collaboration.updateMany({
    where: { id: { in: ids }, organizationId: access.org.id },
    data,
  });
  await logAudit(
    access.org.id,
    access.user.id,
    archive ? "COLLABORATION_BULK_ARCHIVE" : "COLLABORATION_BULK_STATUS",
    {
      targetType: "collaboration",
      metadata: { count: result.count, ids, status: body.status ?? null },
    },
  );
  return NextResponse.json({ ok: true, count: result.count });
});
