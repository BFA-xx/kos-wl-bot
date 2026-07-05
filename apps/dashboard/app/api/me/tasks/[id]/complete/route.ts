import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireUser } from "@/lib/access";
import { verifyTask } from "@/lib/verify";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Run the verification engine for one task as the signed-in user. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await prisma.taskDefinition.findUnique({ where: { id: params.id } });
    if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });

    // Already verified? Don't re-run (keeps evidence + reviewer decisions).
    const existing = await prisma.taskCompletion.findUnique({
      where: { taskId_userId: { taskId: task.id, userId: user.id } },
    });
    if (existing?.status === "VERIFIED") {
      return NextResponse.json({ status: "VERIFIED" });
    }
    if (existing?.status === "NEEDS_REVIEW") {
      return NextResponse.json({
        status: "NEEDS_REVIEW",
        reason: "Already submitted — the team will review it shortly.",
      });
    }

    const result = await verifyTask(task, user.id);

    await prisma.taskCompletion.upsert({
      where: { taskId_userId: { taskId: task.id, userId: user.id } },
      create: {
        taskId: task.id,
        userId: user.id,
        status: result.status,
        evidence: result.evidence as Prisma.InputJsonValue | undefined,
        verifiedAt: result.status === "VERIFIED" ? new Date() : null,
      },
      update: {
        status: result.status,
        evidence: result.evidence as Prisma.InputJsonValue | undefined,
        verifiedAt: result.status === "VERIFIED" ? new Date() : null,
      },
    });

    return NextResponse.json({
      status: result.status,
      reason: result.reason ?? null,
      action: result.action ?? null,
    });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("task complete failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
