import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { toCsv } from "@/lib/csv";
import { addressesWorkbook, type AddressRow } from "@/lib/xlsx";
import { logAudit, requireOrgAccess, withAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { syncCollaborationState } from "@/lib/collab";
import { selectConfiguredWallet } from "@/lib/winner-wallet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withAccess(async (request, { params }) => {
  const req = request as NextRequest;
  const { org, user } = await requireOrgAccess(
    params.org,
    PERMISSIONS.COLLAB_EXPORT,
  );
  await syncCollaborationState(params.id, org.id);
  const collaboration = await prisma.collaboration.findFirst({
    where: { id: params.id, organizationId: org.id },
    include: {
      wallets: {
        where: { status: { not: "REJECTED" } },
        include: {
          winner: {
            include: {
              wallet: true,
              raffle: { select: { walletChains: true } },
            },
          },
          user: { include: { walletProfiles: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!collaboration) {
    return NextResponse.json(
      { error: "Collaboration not found." },
      { status: 404 },
    );
  }

  const rows = collaboration.wallets
    .map((item) => {
      const source = item.winner
        ? selectConfiguredWallet(
            item.winner.wallet,
            item.user.walletProfiles,
            item.winner.raffle.walletChains,
          )
        : null;
      if (!source || source.chain !== item.chain) return null;
      return {
        walletId: item.id,
        userId: item.userId,
        username: item.user.globalName ?? item.user.username,
        chain: source.chain,
        address: decryptSecret(source.address),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  if (!rows.length) {
    return NextResponse.json(
      { error: "No collected wallets are ready to export." },
      { status: 409 },
    );
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.collaborationWallet.updateMany({
      where: { id: { in: rows.map((row) => row.walletId) } },
      data: { status: "SUBMITTED", submittedAt: now, updatedById: user.id },
    }),
    prisma.collaboration.update({
      where: { id: collaboration.id },
      data: {
        status: "SUBMITTED",
        submissionStatus: "SUBMITTED",
        exportedAt: now,
        lastActivityAt: now,
      },
    }),
    prisma.collaborationActivity.create({
      data: {
        collaborationId: collaboration.id,
        actorId: user.id,
        action: "WALLETS_EXPORTED",
        title: `${rows.length} wallet${rows.length === 1 ? "" : "s"} exported`,
      },
    }),
  ]);
  await logAudit(org.id, user.id, "COLLABORATION_WALLETS_EXPORT", {
    targetType: "collaboration",
    targetId: collaboration.id,
    metadata: { count: rows.length },
  });

  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  const safe = collaboration.projectName
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  if (format === "xlsx") {
    const addressRows: AddressRow[] = rows.map((row) => ({
      username: row.username,
      chain: row.chain,
      address: row.address,
    }));
    const workbook = await addressesWorkbook(
      collaboration.projectName,
      addressRows,
      "full",
    );
    return new Response(new Uint8Array(workbook), {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="KOS-collab-${safe}.xlsx"`,
      },
    });
  }
  if (format === "txt") {
    return new Response(rows.map((row) => row.address).join("\n") + "\n", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="KOS-collab-${safe}.txt"`,
      },
    });
  }
  const csv = toCsv(
    ["discord_id", "username", "chain", "wallet_address"],
    rows.map((row) => [row.userId, row.username, row.chain, row.address]),
  );
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="KOS-collab-${safe}.csv"`,
    },
  });
});
