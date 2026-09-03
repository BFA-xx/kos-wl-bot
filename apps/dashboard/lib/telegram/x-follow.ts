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
  /** Verification is switched off or out of budget — the gate does not block. */
  | { status: "stood_down"; target: string; handle: string | null }
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

  // Turning verification off is a deliberate operator action, so the gate
  // stands down rather than blocking: we cannot require what we have chosen to
  // stop checking, and halting every new member over our own switch is worse
  // than losing some follows. This is the emergency release during an event.
  if (!xVerifyConfigured()) return { status: "stood_down", target, handle };

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
  // Our own spend ceiling, not the member's doing. Blocking every new member
  // at read 801 would stall an event for a reason none of them can act on.
  if (check.outcome === "budget_exhausted" || check.outcome === "disabled") {
    return { status: "stood_down", target, handle };
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
