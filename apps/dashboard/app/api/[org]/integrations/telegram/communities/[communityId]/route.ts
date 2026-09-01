import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import {
  TELEGRAM_FEATURE_FLAGS,
  verifyTelegramCommunity,
} from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: { org: string; communityId: string } },
) {
  try {
    const { org, user } = await requireOrgAccess(
      params.org,
      PERMISSIONS.SETTINGS_EDIT,
    );
    const existing = await prisma.telegramCommunity.findFirst({
      where: { id: params.communityId, organizationId: org.id },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Community not found." },
        { status: 404 },
      );
    }
    const body = await request.json().catch(() => ({}));
    const status = body.status === "DISABLED" ? "DISABLED" : "ACTIVE";
    let botVerifiedAt = existing.botVerifiedAt;
    if (status === "ACTIVE") {
      const verified = await verifyTelegramCommunity(existing.telegramChatId);
      if (!verified.ok) {
        return NextResponse.json({ error: verified.reason }, { status: 409 });
      }
      botVerifiedAt = new Date();
    }
    const featureFlags = Array.isArray(body.featureFlags)
      ? body.featureFlags.filter((flag: unknown): flag is string =>
          TELEGRAM_FEATURE_FLAGS.includes(
            flag as (typeof TELEGRAM_FEATURE_FLAGS)[number],
          ),
        )
      : existing.featureFlags;
    const community = await prisma.telegramCommunity.update({
      where: { id: existing.id },
      data: { status, featureFlags, botVerifiedAt },
    });
    await logAudit(org.id, user.id, "TELEGRAM_COMMUNITY_UPDATE", {
      targetType: "telegram_community",
      targetId: community.id,
      metadata: { status, featureFlags },
    });
    return NextResponse.json({ community });
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
