import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, logAudit } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { Prisma, type WalletChain } from "@prisma/client";
import { sanitizeHttpUrl, sanitizeLegacyRaffleTasks } from "@/lib/raffle-input";
import { parsePublicRaffleId } from "@/lib/raffle-share";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CHAINS = ["ETHEREUM", "BASE", "ROBINHOOD", "SOLANA", "BITCOIN"];

export async function GET(
  _req: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { guildIds } = await requireOrgAccess(params.org);
    const id = Number(params.id);
    if (!Number.isFinite(id))
      return NextResponse.json({ error: "bad id" }, { status: 400 });

    const raffle = await prisma.raffle.findFirst({
      where: { id, guildId: { in: guildIds } },
      include: {
        eligibleRoles: true,
        RaffleTask: {
          orderBy: { id: "asc" },
          select: {
            taskId: true,
            required: true,
            task: { select: { title: true, type: true, active: true } },
          },
        },
        winners: { where: { replaced: false }, orderBy: { position: "asc" } },
        proof: true,
        _count: { select: { participants: true } },
      },
    });
    if (!raffle)
      return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ raffle });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * Edit a raffle. Updates the DB, and if the raffle is already posted, sets
 * editRequestedAt so the bot re-renders the Discord post (the dashboard can't
 * reach the bot directly).
 */
export async function PATCH(
  req: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.RAFFLE_EDIT,
    );
    const id = Number(params.id);
    const existing = await prisma.raffle.findFirst({
      where: { id, guildId: { in: guildIds } },
      select: {
        id: true,
        status: true,
        messageId: true,
        startAt: true,
        requirements: true,
      },
    });
    if (!existing)
      return NextResponse.json({ error: "not found" }, { status: 404 });
    if (existing.status === "ENDED" || existing.status === "CANCELLED") {
      return NextResponse.json(
        { error: "This raffle has ended and can't be edited." },
        { status: 400 },
      );
    }

    const b = await req.json().catch(() => ({}));
    const data: Prisma.RaffleUpdateInput = {};
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

    if (str(b.projectName)) data.projectName = str(b.projectName);
    if (str(b.title)) data.title = str(b.title);
    if ("description" in b)
      data.description = b.description ? String(b.description) : null;
    if (Number.isInteger(b.spots) && b.spots > 0) data.spots = b.spots;
    if ("bannerUrl" in b)
      data.bannerUrl = b.bannerUrl ? String(b.bannerUrl) : null;
    if ("externalUrl" in b) data.externalUrl = sanitizeHttpUrl(b.externalUrl);
    if ("hideEntries" in b) data.hideEntries = Boolean(b.hideEntries);
    if ("requireWallet" in b) data.requireWallet = Boolean(b.requireWallet);
    if ("useRoleWeights" in b) data.useRoleWeights = Boolean(b.useRoleWeights);
    if (["everyone", "here", "none"].includes(b.startPing))
      data.startPing = b.startPing;
    if (b.roleMatchMode === "ALL" || b.roleMatchMode === "ANY")
      data.roleMatchMode = b.roleMatchMode;
    if ("announceChannelId" in b)
      data.announceChannelId = /^\d{5,25}$/.test(String(b.announceChannelId))
        ? String(b.announceChannelId)
        : null;
    if ("proofChannelId" in b)
      data.proofChannelId = /^\d{5,25}$/.test(String(b.proofChannelId))
        ? String(b.proofChannelId)
        : null;

    if (Array.isArray(b.walletChains)) {
      const wc = b.walletChains.filter((c: string) =>
        CHAINS.includes(c),
      ) as WalletChain[];
      if (wc.length) data.walletChains = wc;
    }
    if ("collectWallets" in b) data.collectWallets = Boolean(b.collectWallets);

    if (Array.isArray(b.tasks)) {
      const tasks = sanitizeLegacyRaffleTasks(b.tasks);
      const requirements = {
        ...((existing.requirements ?? {}) as Record<string, unknown>),
      };
      if (tasks.length) requirements.tasks = tasks;
      else delete requirements.tasks;
      data.requirements = Object.keys(requirements).length
        ? (requirements as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    }

    if (b.startAt && existing.status === "UPCOMING") {
      const s = new Date(b.startAt);
      if (!isNaN(s.getTime())) data.startAt = s;
    }
    if (b.endAt) {
      const e = new Date(b.endAt);
      if (isNaN(e.getTime()) || e.getTime() <= Date.now()) {
        return NextResponse.json(
          { error: "End time must be in the future." },
          { status: 400 },
        );
      }
      data.endAt = e;
    }

    // Prepare relation replacements. They are applied in the same transaction
    // as the raffle update so a failed edit cannot leave partial gate changes.
    const roles: { roleId: string; roleName: string }[] | null = Array.isArray(
      b.roles,
    )
      ? (b.roles as { roleId?: unknown; roleName?: unknown }[])
          .filter((r) => /^\d{5,25}$/.test(String(r?.roleId)))
          .map((r) => ({
            roleId: String(r.roleId),
            roleName: String(r.roleName ?? r.roleId),
          }))
      : null;

    const verificationTaskIds: string[] | null = Array.isArray(
      b.verificationTaskIds,
    )
      ? [
          ...new Set<string>(
            (b.verificationTaskIds as unknown[]).filter(
              (x: unknown): x is string => typeof x === "string",
            ),
          ),
        ].slice(0, 20)
      : null;

    // If already posted, ask the bot to re-render the embed.
    if (existing.messageId) data.editRequestedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.raffle.update({ where: { id }, data });

      if (roles) {
        const uniqueRoles = [
          ...new Map(roles.map((r) => [r.roleId, r])).values(),
        ];
        await tx.raffleRole.deleteMany({ where: { raffleId: id } });
        if (uniqueRoles.length) {
          await tx.raffleRole.createMany({
            data: uniqueRoles.map((r) => ({ raffleId: id, ...r })),
          });
        }
      }

      if (verificationTaskIds) {
        const valid = verificationTaskIds.length
          ? await tx.taskDefinition.findMany({
              where: {
                id: { in: verificationTaskIds },
                organizationId: org.id,
                active: true,
              },
              select: { id: true },
            })
          : [];
        await tx.raffleTask.deleteMany({ where: { raffleId: id } });
        if (valid.length) {
          await tx.raffleTask.createMany({
            data: valid.map((t) => ({
              raffleId: id,
              taskId: t.id,
              required: true,
            })),
          });
        }
      }
    });
    await logAudit(org.id, user.id, "RAFFLE_EDIT", {
      targetType: "raffle",
      targetId: String(id),
    });
    return NextResponse.json({
      ok: true,
      willRefresh: Boolean(existing.messageId),
    });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("raffle edit failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** Queue a tenant-scoped deletion for the bot, which owns Discord + EC2 files. */
export async function DELETE(
  _req: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.RAFFLE_DELETE,
    );
    const id = parsePublicRaffleId(params.id);
    if (!id) {
      return NextResponse.json(
        { error: "Invalid raffle ID." },
        { status: 400 },
      );
    }

    const raffle = await prisma.raffle.findFirst({
      where: { id, guildId: { in: guildIds } },
      select: {
        id: true,
        guildId: true,
        projectName: true,
        title: true,
        status: true,
        channelId: true,
        messageId: true,
      },
    });
    if (!raffle) {
      return NextResponse.json({ error: "Raffle not found." }, { status: 404 });
    }

    const existingRequest = await prisma.log.findFirst({
      where: { raffleId: id, action: "RAFFLE_DELETE_REQUEST" },
      select: { id: true },
    });
    if (existingRequest) {
      return NextResponse.json({ ok: true, id, queued: true });
    }

    await prisma.$transaction(async (tx) => {
      // Cancel immediately so entry/draw/publish flows stop while the bot
      // performs Discord and proof-file cleanup on its next scheduler tick.
      await tx.raffle.update({
        where: { id },
        data: {
          status: "CANCELLED",
          editRequestedAt: null,
          rerollRequest: Prisma.DbNull,
          rerollRequestedAt: null,
        },
      });
      await tx.log.create({
        data: {
          guildId: raffle.guildId,
          raffleId: id,
          actorId: user.id,
          category: "RAFFLE",
          action: "RAFFLE_DELETE_REQUEST",
          message: `Dashboard deletion requested for raffle #${id}`,
        },
      });
    });
    await logAudit(org.id, user.id, "RAFFLE_DELETE_REQUEST", {
      targetType: "raffle",
      targetId: String(id),
      metadata: {
        guildId: raffle.guildId,
        projectName: raffle.projectName,
        title: raffle.title,
        status: raffle.status,
      },
    });

    return NextResponse.json({ ok: true, id, queued: true });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("raffle delete failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
