import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, logAudit } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import type { TaskType, Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TYPES: TaskType[] = [
  "X_FOLLOW",
  "X_LIKE",
  "X_REPOST",
  "X_COMMENT",
  "DISCORD_JOIN",
  "DISCORD_ROLE",
  "VISIT_LINK",
  "MANUAL",
];

/** List the org's tasks (builder + raffle wizard picker). */
export async function GET(_req: Request, { params }: { params: { org: string } }) {
  try {
    const { org } = await requireOrgAccess(params.org, PERMISSIONS.RAFFLE_CREATE);
    const tasks = await prisma.taskDefinition.findMany({
      where: { organizationId: org.id },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { completions: { where: { status: "VERIFIED" } } } } },
    });
    return NextResponse.json({
      tasks: tasks.map((t) => ({
        id: t.id,
        type: t.type,
        title: t.title,
        description: t.description,
        config: t.config,
        points: t.points,
        active: t.active,
        expiresAt: t.expiresAt,
        verifiedCount: t._count.completions,
      })),
    });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** Create a task. */
export async function POST(req: Request, { params }: { params: { org: string } }) {
  try {
    const { org, user } = await requireOrgAccess(params.org, PERMISSIONS.RAFFLE_CREATE);
    const b = await req.json().catch(() => ({}));

    const type = TYPES.includes(b.type) ? (b.type as TaskType) : null;
    const title = String(b.title ?? "").trim();
    if (!type || !title) {
      return NextResponse.json({ error: "Type and title are required." }, { status: 400 });
    }

    const cfg: Record<string, string> = {};
    const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const c = (b.config ?? {}) as Record<string, unknown>;
    if (s(c.url)) cfg.url = s(c.url);
    if (s(c.xHandle)) cfg.xHandle = s(c.xHandle).replace(/^@/, "");
    if (s(c.tweetUrl)) cfg.tweetUrl = s(c.tweetUrl);
    if (/^\d{5,25}$/.test(s(c.guildId))) cfg.guildId = s(c.guildId);
    if (s(c.inviteUrl)) cfg.inviteUrl = s(c.inviteUrl);
    if (/^\d{5,25}$/.test(s(c.roleId))) cfg.roleId = s(c.roleId);
    if (s(c.roleName)) cfg.roleName = s(c.roleName);
    if (s(c.instructions)) cfg.instructions = s(c.instructions).slice(0, 500);

    // Per-type required config.
    if (type === "X_FOLLOW" && !cfg.xHandle)
      return NextResponse.json({ error: "X handle is required for a follow task." }, { status: 400 });
    if (["X_LIKE", "X_REPOST", "X_COMMENT"].includes(type) && !cfg.tweetUrl)
      return NextResponse.json({ error: "Post URL is required for this task." }, { status: 400 });
    if (["DISCORD_JOIN", "DISCORD_ROLE"].includes(type) && !cfg.guildId)
      return NextResponse.json({ error: "Pick the Discord server for this task." }, { status: 400 });
    if (type === "DISCORD_ROLE" && !cfg.roleId)
      return NextResponse.json({ error: "Pick the role for this task." }, { status: 400 });
    if (type === "VISIT_LINK" && !cfg.url)
      return NextResponse.json({ error: "URL is required for a visit task." }, { status: 400 });

    const task = await prisma.taskDefinition.create({
      data: {
        organizationId: org.id,
        type,
        title: title.slice(0, 120),
        description: b.description ? String(b.description).slice(0, 500) : null,
        config: cfg as Prisma.InputJsonValue,
        points: Number.isInteger(b.points) && b.points >= 0 ? b.points : 0,
        expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
        createdById: user.id,
      },
    });
    await logAudit(org.id, user.id, "TASK_CREATE", { targetType: "task", targetId: task.id });
    return NextResponse.json({ ok: true, id: task.id });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("task create failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
