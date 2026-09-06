import { LogCategory } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  LEGACY_TASK_VERIFY,
  type LegacyRaffleTask,
} from "@/lib/legacy-raffle-tasks";

interface LegacyTaskAttestationInput {
  guildId: string;
  raffleId: number;
  userId: string;
  username: string;
  task: LegacyRaffleTask;
  method: "telegram_attest";
}

/** Record the legacy click-and-attest policy against the exact linked KOS user. */
export async function attestLegacyRaffleTask(
  input: LegacyTaskAttestationInput,
): Promise<{ created: boolean }> {
  const existing = await prisma.log.findFirst({
    where: {
      actorId: input.userId,
      action: LEGACY_TASK_VERIFY,
      OR: [
        {
          raffleId: input.raffleId,
          metadata: { path: ["taskKey"], equals: input.task.key },
        },
        ...(input.task.sharedKey
          ? [
              {
                metadata: {
                  path: ["sharedTaskKey"],
                  equals: input.task.sharedKey,
                },
              },
            ]
          : []),
      ],
    },
    select: { id: true },
  });
  if (existing) return { created: false };

  await prisma.log.create({
    data: {
      guildId: input.guildId,
      raffleId: input.raffleId,
      actorId: input.userId,
      category: LogCategory.ENTRY,
      action: LEGACY_TASK_VERIFY,
      message: `${input.username} verified "${input.task.label}" for raffle #${input.raffleId}`,
      metadata: {
        taskId: input.task.id,
        taskKey: input.task.key,
        sharedTaskKey: input.task.sharedKey,
        label: input.task.label,
        url: input.task.url,
        method: input.method,
      },
    },
  });

  return { created: true };
}
