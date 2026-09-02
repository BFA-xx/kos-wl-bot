import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { awardKosPoints } from "@/lib/telegram/points";

function newReferralCode(): string {
  return randomBytes(7).toString("base64url");
}

export async function ensureReferralCode(identityId: string): Promise<string> {
  const identity = await prisma.kosIdentity.findUniqueOrThrow({
    where: { id: identityId },
    select: { referralCode: true },
  });
  if (identity.referralCode) return identity.referralCode;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = newReferralCode();
    const updated = await prisma.kosIdentity
      .updateMany({
        where: { id: identityId, referralCode: null },
        data: { referralCode: code },
      })
      .catch(() => ({ count: 0 }));
    if (updated.count === 1) return code;
    const current = await prisma.kosIdentity.findUniqueOrThrow({
      where: { id: identityId },
      select: { referralCode: true },
    });
    if (current.referralCode) return current.referralCode;
  }
  throw new Error("Could not allocate a KOS referral code");
}

export async function recordReferral(
  referredIdentityId: string,
  referralCode: string,
): Promise<"recorded" | "existing" | "invalid" | "self"> {
  const referrer = await prisma.kosIdentity.findUnique({
    where: { referralCode },
    select: {
      id: true,
      referralReceived: { select: { referrerIdentityId: true } },
    },
  });
  if (!referrer) return "invalid";
  if (referrer.id === referredIdentityId) return "self";
  const referred = await prisma.kosIdentity.findUnique({
    where: { id: referredIdentityId },
    select: { onboardingStatus: true },
  });
  if (
    !referred ||
    referred.onboardingStatus === "COMPLETED" ||
    referrer.referralReceived?.referrerIdentityId === referredIdentityId
  ) {
    return "invalid";
  }
  const existing = await prisma.kosReferral.findUnique({
    where: { referredIdentityId },
    select: { id: true },
  });
  if (existing) return "existing";
  await prisma.kosReferral.create({
    data: { referrerIdentityId: referrer.id, referredIdentityId },
  });
  return "recorded";
}

export async function completeReferral(
  referredIdentityId: string,
): Promise<void> {
  const referral = await prisma.$transaction(async (tx) => {
    const pending = await tx.kosReferral.findUnique({
      where: { referredIdentityId },
    });
    if (!pending || pending.status !== "PENDING") return null;
    return tx.kosReferral.update({
      where: { id: pending.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  });
  if (!referral) return;
  await awardKosPoints({
    identityId: referral.referrerIdentityId,
    event: "REFERRAL_COMPLETED",
    reason: "KOS referral completed",
    source: "telegram_referral",
    referenceId: referral.id,
  });
}
