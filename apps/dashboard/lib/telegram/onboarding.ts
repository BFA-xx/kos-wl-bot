import type { User as TelegramUser } from "grammy/types";
import { prisma } from "@/lib/db";
import { ensureTelegramIdentity } from "@/lib/telegram/identity";
import { awardKosPoints } from "@/lib/telegram/points";
import { completeReferral } from "@/lib/telegram/referrals";

export async function completeTelegramOnboarding(user: TelegramUser): Promise<{
  identityId: string;
  newlyCompleted: boolean;
  pendingApprovals: number;
}> {
  const identity = await ensureTelegramIdentity(user);
  const updated = await prisma.kosIdentity.updateMany({
    where: { id: identity.id, onboardingStatus: { not: "COMPLETED" } },
    data: { onboardingStatus: "COMPLETED" },
  });
  const pendingApprovals = await prisma.telegramCommunityMember.count({
    where: { identityId: identity.id, approvalStatus: "PENDING" },
  });
  return {
    identityId: identity.id,
    newlyCompleted: updated.count === 1,
    pendingApprovals,
  };
}

export async function activateApprovedOnboarding(
  identityId: string,
): Promise<number> {
  const reward = await awardKosPoints({
    identityId,
    event: "ONBOARDING_COMPLETED",
    reason: "KOS Telegram onboarding approved",
    source: "telegram_onboarding",
    referenceId: identityId,
  });
  await completeReferral(identityId);
  return reward.awarded ? reward.amount : 0;
}
