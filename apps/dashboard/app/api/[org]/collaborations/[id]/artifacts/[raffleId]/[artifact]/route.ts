import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrgAccess, withAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { decryptSecret } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ARTIFACTS = {
  pdf: { field: "pdfData", type: "application/pdf", extension: "pdf" },
  csv: { field: "csvData", type: "text/csv; charset=utf-8", extension: "csv" },
  card: { field: "cardData", type: "image/png", extension: "png" },
} as const;

export const GET = withAccess(async (_request, { params }) => {
  const artifact = ARTIFACTS[params.artifact as keyof typeof ARTIFACTS];
  const raffleId = Number(params.raffleId);
  if (!artifact || !Number.isInteger(raffleId) || raffleId <= 0) {
    return NextResponse.json(
      { error: "Invalid proof artifact." },
      { status: 400 },
    );
  }
  const { org, guildIds } = await requireOrgAccess(
    params.org,
    params.artifact === "csv"
      ? PERMISSIONS.COLLAB_EXPORT
      : PERMISSIONS.COLLAB_VIEW,
  );
  const link = await prisma.collaborationRaffle.findFirst({
    where: {
      collaborationId: params.id,
      raffleId,
      collaboration: { organizationId: org.id },
      raffle: { guildId: { in: guildIds } },
    },
    select: {
      raffle: {
        select: {
          projectName: true,
          proof: {
            select: { pdfData: true, csvData: true, cardData: true },
          },
        },
      },
    },
  });
  const data = link?.raffle.proof?.[artifact.field];
  if (!data) {
    return NextResponse.json(
      { error: "This proof artifact is not available yet." },
      { status: 404 },
    );
  }
  const safeProject =
    link.raffle.projectName
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "raffle";
  const value = decryptSecret(Buffer.from(data).toString("utf8"));
  if (value === "[encrypted]" || value === "[decrypt-error]") {
    return NextResponse.json(
      { error: "Proof decryption is temporarily unavailable." },
      { status: 503 },
    );
  }
  const decrypted = Buffer.from(value, "base64");
  return new Response(new Uint8Array(decrypted), {
    headers: {
      "content-type": artifact.type,
      "content-disposition": `attachment; filename="KOS-${safeProject}-${raffleId}-${params.artifact}.${artifact.extension}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
