import { NextResponse } from "next/server";
import { PingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { parsePingInput } from "@/lib/ping-input";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.PING_EDIT,
    );
    const ping = await prisma.ping.findFirst({
      where: { id: params.id, organizationId: org.id },
    });
    if (!ping)
      return NextResponse.json({ error: "Ping not found." }, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const action = String(body.action ?? "");

    if (action === "cancel") {
      if (
        !(
          [
            PingStatus.DRAFT,
            PingStatus.SCHEDULED,
            PingStatus.FAILED,
          ] as PingStatus[]
        ).includes(ping.status)
      )
        return NextResponse.json(
          { error: "This ping can no longer be cancelled." },
          { status: 409 },
        );
      const cancelled = await prisma.ping.updateMany({
        where: { id: ping.id, status: ping.status },
        data: { status: PingStatus.CANCELLED, sendingAt: null },
      });
      if (cancelled.count === 0)
        return NextResponse.json(
          { error: "Ping delivery already started." },
          { status: 409 },
        );
      await audit(org.id, user.id, ping.id, "PING_CANCEL");
      return NextResponse.json({ ok: true });
    }

    if (action === "retry") {
      if (ping.status !== PingStatus.FAILED)
        return NextResponse.json(
          { error: "Only a failed ping can be retried." },
          { status: 409 },
        );
      const retried = await prisma.ping.updateMany({
        where: { id: ping.id, status: PingStatus.FAILED },
        data: {
          status: PingStatus.SCHEDULED,
          scheduledAt: new Date(),
          sendingAt: null,
          failureReason: null,
        },
      });
      if (retried.count === 0)
        return NextResponse.json(
          { error: "Ping status changed. Refresh and try again." },
          { status: 409 },
        );
      await audit(org.id, user.id, ping.id, "PING_RETRY");
      return NextResponse.json({ ok: true });
    }

    if (
      !(
        [
          PingStatus.DRAFT,
          PingStatus.SCHEDULED,
          PingStatus.FAILED,
        ] as PingStatus[]
      ).includes(ping.status)
    )
      return NextResponse.json(
        { error: "This ping can no longer be edited." },
        { status: 409 },
      );
    const input = parsePingInput(body);
    if ("error" in input)
      return NextResponse.json({ error: input.error }, { status: 400 });
    if (!guildIds.includes(input.guildId))
      return NextResponse.json(
        { error: "That Discord server is not connected to this organization." },
        { status: 403 },
      );
    const publish = body.publish === true;
    const updated = await prisma.ping.updateMany({
      where: { id: ping.id, status: ping.status },
      data: {
        ...input,
        status: publish
          ? PingStatus.SCHEDULED
          : ping.status === PingStatus.FAILED
            ? PingStatus.DRAFT
            : ping.status,
        scheduledAt: publish
          ? normalizeScheduledAt(input.scheduledAt)
          : input.scheduledAt,
        sendingAt: null,
        failureReason: null,
      },
    });
    if (updated.count === 0)
      return NextResponse.json(
        { error: "Ping delivery already started." },
        { status: 409 },
      );
    await audit(org.id, user.id, ping.id, "PING_EDIT");
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("ping update failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function normalizeScheduledAt(value: Date | null): Date {
  const now = new Date();
  return value && value > now ? value : now;
}

async function audit(
  organizationId: string,
  actorId: string,
  pingId: string,
  action: string,
) {
  await logAudit(organizationId, actorId, action, {
    targetType: "ping",
    targetId: pingId,
  });
}
