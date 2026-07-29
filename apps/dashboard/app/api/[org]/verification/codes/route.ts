import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { parseVerificationCodeInput } from "@/lib/verification";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: { org: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.SETTINGS_EDIT,
    );
    const body = await req.json().catch(() => null);
    const guildId =
      body && typeof body.guildId === "string" ? body.guildId.trim() : "";
    if (!guildIds.includes(guildId)) {
      return NextResponse.json(
        { error: "That server isn't connected to this organization." },
        { status: 403 },
      );
    }
    const parsed = parseVerificationCodeInput(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const code = await prisma.verificationCode.create({
      data: {
        guildId,
        ...parsed.value,
        createdById: user.id,
      },
    });
    await logAudit(org.id, user.id, "VERIFICATION_CODE_CREATE", {
      targetType: "verification_code",
      targetId: code.id,
      metadata: { guildId, code: code.code, roleIds: code.roleIds },
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
    console.error("verification code create failed", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
