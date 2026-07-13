import "server-only";

import { prisma } from "@/lib/db";
import type {
  CollaborationStatus,
  CollaborationSubmissionStatus,
  CollaborationWalletStatus,
} from "@prisma/client";

const TERMINAL = new Set<CollaborationStatus>([
  "SUBMITTED",
  "COMPLETED",
  "CANCELLED",
]);

/**
 * Reconcile one collaboration with its attached raffles and the existing
 * encrypted winner/profile wallet registry. No wallet addresses are copied.
 * This is safe to call from detail reads and exports; writes are idempotent.
 */
export async function syncCollaborationState(
  collaborationId: string,
  organizationId: string,
): Promise<void> {
  const collaboration = await prisma.collaboration.findFirst({
    where: { id: collaborationId, organizationId },
    include: {
      wallets: true,
      raffles: {
        include: {
          raffle: {
            select: {
              id: true,
              status: true,
              walletChains: true,
              winners: {
                where: { replaced: false },
                include: {
                  wallet: true,
                  user: { include: { walletProfiles: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!collaboration) return;

  const existingByUser = new Map(
    collaboration.wallets.map((wallet) => [wallet.userId, wallet]),
  );
  const seen = new Set<string>();

  for (const link of collaboration.raffles) {
    for (const winner of link.raffle.winners) {
      if (seen.has(winner.userId)) continue;
      seen.add(winner.userId);
      const current = existingByUser.get(winner.userId);
      const preferredProfile = link.raffle.walletChains
        .map((chain) =>
          winner.user.walletProfiles.find((p) => p.chain === chain),
        )
        .find(Boolean);
      const fallbackProfile = winner.user.walletProfiles[0];
      const source =
        winner.wallet ?? preferredProfile ?? fallbackProfile ?? null;
      const detectedStatus: CollaborationWalletStatus = source
        ? "COLLECTED"
        : "WAITING";
      const status =
        current && current.status !== "WAITING"
          ? current.status
          : detectedStatus;
      await prisma.collaborationWallet.upsert({
        where: {
          collaborationId_userId: {
            collaborationId: collaboration.id,
            userId: winner.userId,
          },
        },
        create: {
          collaborationId: collaboration.id,
          userId: winner.userId,
          winnerId: winner.id,
          chain: source?.chain ?? null,
          status,
        },
        update: {
          winnerId: current?.winnerId ?? winner.id,
          chain: source?.chain ?? current?.chain ?? null,
          status,
        },
      });
    }
  }

  if (
    TERMINAL.has(collaboration.status) ||
    collaboration.raffles.length === 0
  ) {
    return;
  }

  const wallets = await prisma.collaborationWallet.findMany({
    where: { collaborationId: collaboration.id },
    select: { status: true },
  });
  const allEnded = collaboration.raffles.every(
    (link) =>
      link.raffle.status === "ENDED" || link.raffle.status === "CANCELLED",
  );
  const required = Math.max(collaboration.whitelistAllocation, wallets.length);
  const collected = wallets.filter(
    (wallet) => wallet.status === "COLLECTED" || wallet.status === "SUBMITTED",
  ).length;

  let nextStatus: CollaborationStatus | null = null;
  let nextSubmission: CollaborationSubmissionStatus | null = null;
  if (!allEnded) {
    nextStatus = "HOSTING";
  } else if (required > 0 && collected >= required) {
    nextStatus = "READY_FOR_SUBMISSION";
    nextSubmission = "READY";
  } else {
    nextStatus = "COLLECTING_WALLETS";
    nextSubmission = "COLLECTING";
  }

  if (
    nextStatus !== collaboration.status ||
    (nextSubmission && nextSubmission !== collaboration.submissionStatus)
  ) {
    await prisma.$transaction([
      prisma.collaboration.update({
        where: { id: collaboration.id },
        data: {
          status: nextStatus,
          ...(nextSubmission ? { submissionStatus: nextSubmission } : {}),
          lastActivityAt: new Date(),
        },
      }),
      prisma.collaborationActivity.create({
        data: {
          collaborationId: collaboration.id,
          action: "AUTOMATION_STATUS",
          title: `Pipeline moved to ${nextStatus.replaceAll("_", " ").toLowerCase()}`,
          body: "Updated automatically from attached raffle and wallet progress.",
          metadata: { required, collected },
        },
      }),
    ]);
  }
}
