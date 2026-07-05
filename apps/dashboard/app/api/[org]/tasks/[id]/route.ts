import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, logAudit } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Toggle active / edit basics. */
export async function PATCH(req: Request, { params }: { params: { org: string; id: string } }) {
  try {
    const { org, user } = await requireOrgAccess(params.org, PERMISSIONS.RAFFLE_CREATE);
    const task = await prisma.taskDefinition.findFirst({
      where: { id: params.id, organizationId: org.id },
    });
    if (!task) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const b = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if ("active" in b) data.active = Boolean(b.active);
    if (typeof b.title === "string" && b.title.trim()) data.title = b.title.trim().slice(0, 120);
    if ("description" in b) data.description = b.description ? String(b.description).slice(0, 500) : null;
    if (Number.isInteger(b.points) && b.points >= 0) data.points = b.points;
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    await prisma.taskDefinition.update({ where: { id: task.id }, data });
    await logAudit(org.id, user.id, "TASK_UPDATE", { targetType: "task", targetId: task.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** Delete a task (cascades completions + raffle links). */
export async function DELETE(_req: Request, { params }: { params: { org: string; id: string } }) {
  try {
    const { org, user } = await requireOrgAccess(params.org, PERMISSIONS.RAFFLE_CREATE);
    const task = await prisma.taskDefinition.findFirst({
      where: { id: params.id, organizationId: org.id },
      select: { id: true },
    });
    if (!task) return NextResponse.json({ error: "Not found." }, { status: 404 });
    await prisma.taskDefinition.delete({ where: { id: task.id } });
    await logAudit(org.id, user.id, "TASK_DELETE", { targetType: "task", targetId: task.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
