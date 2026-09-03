import { prisma } from "@/lib/db";
import { verifyXFollow, xVerifyConfigured } from "@kos/db";
import { normalizeXHandle, xProfileUrl } from "@/lib/organization-social";

/**
 * The X follow gate on Telegram onboarding.
 *
 * Verification runs against the member's OWN X token (see
 * packages/db/src/x-verify.ts) so the follow is proven, not asserted. It costs
 * one billable read per check, which is why the result is stored on the
 * identity account and never re-bought once it passes.
 */

export type XFollowGateState =
  | { status: "not_configured" }
  | { status: "needs_link"; target: string; profileUrl: string }
  | { status: "needs_follow"; target: string; profileUrl: string; handle: string | null }
  | { status: "unverifiable"; target: string; profileUrl: string; handle: string | null; reason: string }
  | { status: "following"; target: string; handle: string | null };

/** The account members are asked to follow. */
export function kosXHandle(): string | null {
  return normalizeXHandle(process.env.KOS_X_HANDLE ?? "");
}

/** A pass, once recorded, is permanent — we do not pay to re-check it. */
async function recordedPass(identityId: string, target: string): Promise<boolean> {
  const account = await prisma.identityAccount.findUnique({
    where: { identityId_provider: { identityId, provider: "X" } },
    select: { metadata: true },
  });
  const followed = (account?.metadata as { followedTargets?: string[] } | null)
    ?.followedTargets;
  return Array.isArray(followed) && followed.includes(target.toLowerCase());
}

async function rememberPass(identityId: string, target: string): Promise<void> {
  const account = await prisma.identityAccount.findUnique({
    where: { identityId_provider: { identityId, provider: "X" } },
    select: { metadata: true },
  });
  const meta = (account?.metadata as Record<string, unknown> | null) ?? {};
  const existing = Array.isArray(meta.followedTargets)
    ? (meta.followedTargets as string[])
    : [];
  const next = [...new Set([...existing, target.toLowerCase()])];
  await prisma.identityAccount.update({
    where: { identityId_provider: { identityId, provider: "X" } },
    data: { metadata: { ...meta, followedTargets: next } },
  });
}

export async function evaluateXFollowGate(
  identityId: string,
): Promise<XFollowGateState> {
  const target = kosXHandle();
  if (!target) return { status: "not_configured" };
  const profileUrl = xProfileUrl(target);

  const account = await prisma.identityAccount.findUnique({
    where: { identityId_provider: { identityId, provider: "X" } },
    select: { username: true, accessToken: true },
  });
  if (!account?.accessToken) return { status: "needs_link", target, profileUrl };

  const handle = account.username;
  if (await recordedPass(identityId, target)) {
    return { status: "following", target, handle };
  }

  // Verification off means we cannot prove a follow. Say so rather than
  // pretending the member failed it.
  if (!xVerifyConfigured()) {
    return {
      status: "unverifiable",
      target,
      profileUrl,
      handle,
      reason: "Follow checks are paused right now.",
    };
  }

  const check = await verifyXFollow(prisma, {
    userId: identityId,
    identityId,
    targetHandle: target,
  });

  if (check.outcome === "following" || check.outcome === "follow_pending") {
    await rememberPass(identityId, target);
    return { status: "following", target, handle };
  }
  if (check.outcome === "not_following") {
    return { status: "needs_follow", target, profileUrl, handle };
  }
  if (check.outcome === "unlinked" || check.outcome === "token_expired") {
    return { status: "needs_link", target, profileUrl };
  }
  return {
    status: "unverifiable",
    target,
    profileUrl,
    handle,
    reason:
      check.outcome === "rate_limited"
        ? "X is rate limiting us. Try again shortly."
        : "We couldn't reach X just now. Try again shortly.",
  };
}
