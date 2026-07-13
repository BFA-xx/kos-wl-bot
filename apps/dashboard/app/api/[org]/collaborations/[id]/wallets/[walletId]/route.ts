import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrgAccess, withAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const PATCH = withAccess(async (req, { params }) => {
  const { org, user } = await requireOrgAccess(
    params.org,
    PERMISSIONS.COLLAB_EDIT,
  );
  const wallet = await prisma.collaborationWallet.findFirst({
    where: {
      id: params.walletId,
      collaborationId: params.id,
      collaboration: { organizationId: org.id },
    },
  });
  if (!wallet)
    return NextResponse.json(
      { error: "Wallet record not found." },
      { status: 404 },
    );
  const body = await req.json().catch(() => ({}));
  const statuses = ["WAITING", "COLLECTED", "SUBMITTED", "REJECTED"];
  if (!statuses.includes(body.status)) {
    return NextResponse.json(
      { error: "Invalid wallet status." },
      { status: 400 },
    );
  }
  await prisma.collaborationWallet.update({
    where: { id: wallet.id },
    data: {
      status: body.status,
      rejectionReason:
        body.status === "REJECTED" && typeof body.rejectionReason === "string"
          ? body.rejectionReason.trim().slice(0, 500)
          : null,
      submittedAt:
        body.status === "SUBMITTED" ? new Date() : wallet.submittedAt,
      updatedById: user.id,
    },
  });
  return NextResponse.json({ ok: true });
});
