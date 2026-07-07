import { prisma } from "@/lib/db";

/** Award task points exactly once per user/task. No-op for zero-point tasks. */
export async function awardTaskPoints({
  organizationId,
  userId,
  taskId,
  taskTitle,
  points,
}: {
  organizationId: string;
  userId: string;
  taskId: string;
  taskTitle: string;
  points: number;
}) {
  if (points <= 0) return;
  await prisma.pointsLedger
    .create({
      data: {
        organizationId,
        userId,
        delta: points,
        reason: `Task: ${taskTitle}`,
        sourceType: "TASK",
        sourceId: taskId,
      },
    })
    // Unique source = already awarded.
    .catch(() => undefined);
}
