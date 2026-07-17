import "server-only";

import { prisma } from "@/lib/db";
import { selectConfiguredWallet } from "@/lib/winner-wallet";
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
  const resolved = new Set<string>();

  for (const link of collaboration.raffles) {
    for (const winner of link.raffle.winners) {
      if (resolved.has(winner.userId)) continue;
      const current = existingByUser.get(winner.userId);
      const source = selectConfiguredWallet(
        winner.wallet,
        winner.user.walletProfiles,
        link.raffle.walletChains,
      );
      if (source) resolved.add(winner.userId);
      const detectedStatus: CollaborationWalletStatus = source
        ? "COLLECTED"
        : "WAITING";
      const status =
        source && current && current.status !== "WAITING"
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
          winnerId: source ? winner.id : (current?.winnerId ?? winner.id),
          chain: source?.chain ?? null,
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
