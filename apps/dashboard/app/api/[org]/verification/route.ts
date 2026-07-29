import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { VerificationLogStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import {
  parseVerificationSettingsPatch,
  VERIFICATION_DEFAULTS,
} from "@/lib/verification";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: { org: string } },
) {
  try {
    const { guildIds } = await requireOrgAccess(params.org);
    const guildId = new URL(req.url).searchParams.get("guildId")?.trim() ?? "";
    if (!guildIds.includes(guildId)) {
      return NextResponse.json(
        { error: "That server isn't connected to this organization." },
        { status: 403 },
      );
    }

    const [settings, codes, logs, verifiedMembers, successes, failures] =
      await Promise.all([
        prisma.verificationSettings.findUnique({ where: { guildId } }),
        prisma.verificationCode.findMany({
          where: { guildId },
          orderBy: [{ active: "desc" }, { createdAt: "desc" }],
          take: 100,
        }),
        prisma.verificationLog.findMany({
          where: { guildId },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
        prisma.memberVerification.count({ where: { guildId } }),
        prisma.verificationLog.count({
          where: { guildId, status: VerificationLogStatus.SUCCESS },
        }),
        prisma.verificationLog.count({
          where: { guildId, status: VerificationLogStatus.FAILURE },
        }),
      ]);

    return NextResponse.json({
      settings: settings ?? {
        guildId,
        ...VERIFICATION_DEFAULTS,
        createdAt: null,
        updatedAt: null,
      },
      codes,
      logs,
      stats: { verifiedMembers, successes, failures },
    });
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("verification settings read failed", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
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
    const parsed = parseVerificationSettingsPatch(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { settings, control } = parsed.value;
    const existing = await prisma.verificationSettings.findUnique({
      where: { guildId },
    });
    const accessSettingsChanged =
      existing !== null &&
      (changed(
        settings.verificationChannelId,
        existing.verificationChannelId,
      ) ||
        changed(settings.rulesChannelId, existing.rulesChannelId) ||
        changed(settings.unverifiedRoleId, existing.unverifiedRoleId) ||
        changedList(settings.allowedChannelIds, existing.allowedChannelIds));
    const implicitAccessSync = Boolean(
      existing?.enabled && accessSettingsChanged,
    );
    const changedUnverifiedRole =
      existing?.unverifiedRoleId &&
      settings.unverifiedRoleId !== undefined &&
      settings.unverifiedRoleId !== existing.unverifiedRoleId
        ? existing.unverifiedRoleId
        : null;
    const cleanupRoleIds = changedUnverifiedRole
      ? [
          ...new Set([
            ...(existing?.accessCleanupRoleIds ?? []),
            changedUnverifiedRole,
          ]),
        ]
      : null;
    const hasControlRequest =
      control.desiredEnabled !== undefined ||
      control.syncAccess ||
      implicitAccessSync ||
      control.publishPanel;
    const controlData = hasControlRequest
      ? {
          controlRequestId: randomUUID(),
          controlRequestedAt: new Date(),
          controlRequestedById: user.id,
          controlError: null,
          ...(control.desiredEnabled !== undefined
            ? { desiredEnabled: control.desiredEnabled }
            : {}),
          ...(control.syncAccess || implicitAccessSync
            ? { accessSyncRequested: true }
            : {}),
          ...(control.publishPanel ? { panelPublishRequested: true } : {}),
        }
      : {};
    const saved = await prisma.verificationSettings.upsert({
      where: { guildId },
      create: {
        guildId,
        ...settings,
        ...controlData,
        ...(cleanupRoleIds ? { accessCleanupRoleIds: cleanupRoleIds } : {}),
      },
      update: {
        ...settings,
        ...controlData,
        ...(cleanupRoleIds
          ? { accessCleanupRoleIds: { set: cleanupRoleIds } }
          : {}),
      },
    });

    await logAudit(org.id, user.id, "VERIFICATION_SETTINGS_UPDATE", {
      targetType: "guild",
      targetId: guildId,
      metadata: {
        requestQueued: hasControlRequest,
        desiredEnabled: control.desiredEnabled,
        syncAccess: control.syncAccess || implicitAccessSync,
        publishPanel: control.publishPanel,
        previousUnverifiedRoleId: changedUnverifiedRole,
      },
    });
    return NextResponse.json({
      ok: true,
      queued: hasControlRequest,
      settings: saved,
    });
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("verification settings update failed", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function changed<T>(next: T | undefined, current: T): boolean {
  return next !== undefined && next !== current;
}

function changedList(next: string[] | undefined, current: string[]): boolean {
  if (next === undefined) return false;
  return (
    next.length !== current.length ||
    next.some((value, index) => value !== current[index])
  );
}
