import { NextResponse } from "next/server";
import { Prisma, VerificationAttemptStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { parseVerificationCodeInput } from "@/lib/verification";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.SETTINGS_EDIT,
    );
    const existing = await prisma.verificationCode.findFirst({
      where: { id: params.id, guildId: { in: guildIds } },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Verification code not found." },
        { status: 404 },
      );
    }
    const body = await req.json().catch(() => null);
    const parsed = parseVerificationCodeInput(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    if (parsed.value.maxUses !== null && parsed.value.maxUses < existing.uses) {
      return NextResponse.json(
        {
          error: `Max uses cannot be lower than the ${existing.uses} redemption${existing.uses === 1 ? "" : "s"} already recorded.`,
        },
        { status: 400 },
      );
    }

    const code = await prisma.verificationCode.update({
      where: { id: existing.id },
      data: {
        ...parsed.value,
        roleIds: { set: parsed.value.roleIds },
      },
    });
    await logAudit(org.id, user.id, "VERIFICATION_CODE_UPDATE", {
      targetType: "verification_code",
      targetId: code.id,
      metadata: {
        guildId: code.guildId,
        code: code.code,
        roleIds: code.roleIds,
      },
    });
    return NextResponse.json({ ok: true, code });
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "That verification code already exists in this server." },
        { status: 409 },
      );
    }
    console.error("verification code update failed", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.SETTINGS_EDIT,
    );
    const code = await prisma.$transaction(async (tx) => {
      const existing = await tx.verificationCode.findFirst({
        where: { id: params.id, guildId: { in: guildIds } },
      });
      if (!existing) return null;
      const processing = await tx.verificationAttempt.count({
        where: {
          codeId: existing.id,
          status: VerificationAttemptStatus.PROCESSING,
        },
      });
      if (processing > 0) {
        throw new CodeInUseError();
      }
      await tx.verificationAttempt.updateMany({
        where: {
          codeId: existing.id,
          status: VerificationAttemptStatus.PENDING,
        },
        data: {
          status: VerificationAttemptStatus.FAILED,
          failureReason:
            "Verification code was deleted by a dashboard administrator.",
        },
      });
      return tx.verificationCode.delete({ where: { id: existing.id } });
    });
    if (!code) {
      return NextResponse.json(
        { error: "Verification code not found." },
        { status: 404 },
      );
    }
    await logAudit(org.id, user.id, "VERIFICATION_CODE_DELETE", {
      targetType: "verification_code",
      targetId: code.id,
      metadata: { guildId: code.guildId, code: code.code },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    if (error instanceof CodeInUseError) {
      return NextResponse.json(
        {
          error:
            "This code is completing a verification right now. Try again in a moment.",
        },
        { status: 409 },
      );
    }
    console.error("verification code delete failed", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

class CodeInUseError extends Error {}
