import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logAudit, requireOrgAccess, withAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { isCollabStatus } from "@/lib/collab-shared";
import { del } from "@vercel/blob";

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
  const action = body.action;
  const archive = action === "archive";
  const remove = action === "delete";
  const assign = action === "assign";
  const access = await requireOrgAccess(
    params.org,
    archive || remove
      ? PERMISSIONS.COLLAB_ARCHIVE
      : assign
        ? PERMISSIONS.COLLAB_ASSIGN
        : PERMISSIONS.COLLAB_EDIT,
  );
  if (remove) {
    const rows = await prisma.collaboration.findMany({
      where: { id: { in: ids }, organizationId: access.org.id },
      select: { id: true, attachments: { select: { url: true } } },
    });
    const result = await prisma.collaboration.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    await Promise.all(
      rows.flatMap((row) =>
        row.attachments.map((attachment) =>
          del(attachment.url).catch(() => undefined),
        ),
      ),
    );
    await logAudit(access.org.id, access.user.id, "COLLABORATION_BULK_DELETE", {
      targetType: "collaboration",
      metadata: { count: result.count, ids },
    });
    return NextResponse.json({ ok: true, count: result.count });
  }
  const assignedToId =
    typeof body.assignedToId === "string" ? body.assignedToId.trim() : "";
  if (assign) {
    const member = assignedToId
      ? await prisma.organizationMember.findFirst({
          where: {
            organizationId: access.org.id,
            userId: assignedToId,
            status: "ACTIVE",
          },
          select: { id: true },
        })
      : null;
    if (!member) {
      return NextResponse.json(
        { error: "Choose an active team member." },
        { status: 400 },
      );
    }
  }
  const data = archive
    ? { archivedAt: new Date(), lastActivityAt: new Date() }
    : assign
      ? { assignedToId, lastActivityAt: new Date() }
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
    archive
      ? "COLLABORATION_BULK_ARCHIVE"
      : assign
        ? "COLLABORATION_BULK_ASSIGN"
        : "COLLABORATION_BULK_STATUS",
    {
      targetType: "collaboration",
      metadata: {
        count: result.count,
        ids,
        status: body.status ?? null,
        assignedToId: assign ? assignedToId : null,
      },
    },
  );
  return NextResponse.json({ ok: true, count: result.count });
});
