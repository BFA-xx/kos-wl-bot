import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { logAudit, requireOrgAccess, withAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { parseWalletImport } from "@/lib/collab-wallet-import";
import { isWalletChain, validateWalletAddress } from "@/lib/wallet-validation";
import { syncCollaborationState } from "@/lib/collab";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withAccess(async (request, { params }) => {
  const { org, user } = await requireOrgAccess(
    params.org,
    PERMISSIONS.COLLAB_EDIT,
  );
  const collaboration = await prisma.collaboration.findFirst({
    where: { id: params.id, organizationId: org.id },
    select: { id: true, projectName: true },
  });
  if (!collaboration) {
    return NextResponse.json(
      { error: "Collaboration not found." },
      { status: 404 },
    );
  }
  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content : "";
  const defaultChain = String(body.defaultChain ?? "ETHEREUM").toUpperCase();
  if (!content.trim()) {
    return NextResponse.json(
      { error: "Paste a wallet list or choose a CSV/TXT file." },
      { status: 400 },
    );
  }
  if (content.length > 1_000_000) {
    return NextResponse.json(
      { error: "Wallet imports must be 1 MB or smaller." },
      { status: 413 },
    );
  }
  if (!isWalletChain(defaultChain)) {
    return NextResponse.json(
      { error: "Unknown default chain." },
      { status: 400 },
    );
  }

  const parsed = parseWalletImport(content, defaultChain);
  const profiles = parsed.rows.length
    ? await prisma.walletProfile.findMany({
        where: {
          userId: { in: [...new Set(parsed.rows.map((row) => row.userId))] },
        },
        include: {
          user: { select: { username: true, globalName: true } },
        },
      })
    : [];
  const profileByKey = new Map(
    profiles.map((profile) => [`${profile.userId}:${profile.chain}`, profile]),
  );
  const accepted: typeof parsed.rows = [];
  const errors = [...parsed.errors];
  for (const row of parsed.rows) {
    const profile = profileByKey.get(`${row.userId}:${row.chain}`);
    if (!profile) {
      errors.push({
        row: row.row,
        error: "This user has not registered a wallet for that chain in KOS.",
      });
      continue;
    }
    const registered = validateWalletAddress(
      profile.chain,
      decryptSecret(profile.address),
    );
    if (!registered.ok || registered.normalized !== row.address) {
      errors.push({
        row: row.row,
        error: "The address does not match the user's registered KOS wallet.",
      });
      continue;
    }
    accepted.push(row);
  }
  if (!accepted.length) {
    return NextResponse.json(
      {
        error: "No wallet rows could be imported.",
        imported: 0,
        errors: errors.slice(0, 100),
      },
      { status: 422 },
    );
  }

  const existing = await prisma.collaborationWallet.findMany({
    where: {
      collaborationId: collaboration.id,
      userId: { in: accepted.map((row) => row.userId) },
    },
    select: { userId: true, status: true },
  });
  const statusByUser = new Map(
    existing.map((item) => [item.userId, item.status]),
  );
  await prisma.$transaction(async (tx) => {
    for (const row of accepted) {
      const currentStatus = statusByUser.get(row.userId);
      await tx.collaborationWallet.upsert({
        where: {
          collaborationId_userId: {
            collaborationId: collaboration.id,
            userId: row.userId,
          },
        },
        create: {
          collaborationId: collaboration.id,
          userId: row.userId,
          chain: row.chain,
          status: "COLLECTED",
          updatedById: user.id,
        },
        update: {
          chain: row.chain,
          status: currentStatus === "SUBMITTED" ? "SUBMITTED" : "COLLECTED",
          rejectionReason: null,
          updatedById: user.id,
        },
      });
    }
    await tx.collaborationActivity.create({
      data: {
        collaborationId: collaboration.id,
        actorId: user.id,
        action: "WALLET_LIST_IMPORTED",
        title: `${accepted.length} registered wallet${accepted.length === 1 ? "" : "s"} imported`,
        body: errors.length
          ? `${errors.length} row${errors.length === 1 ? "" : "s"} skipped with validation feedback.`
          : null,
      },
    });
    await tx.collaboration.update({
      where: { id: collaboration.id },
      data: { lastActivityAt: new Date() },
    });
  });
  await logAudit(org.id, user.id, "COLLABORATION_WALLETS_IMPORTED", {
    targetType: "collaboration",
    targetId: collaboration.id,
    metadata: { imported: accepted.length, rejected: errors.length },
  });
  await syncCollaborationState(collaboration.id, org.id);
  return NextResponse.json({
    imported: accepted.length,
    errors: errors.slice(0, 100),
  });
});
