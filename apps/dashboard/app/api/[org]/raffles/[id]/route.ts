import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, logAudit } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { Prisma, type WalletChain } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CHAINS = ["ETHEREUM", "BASE", "SOLANA", "BITCOIN"];

export async function GET(
  _req: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { guildIds } = await requireOrgAccess(params.org);
    const id = Number(params.id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

    const raffle = await prisma.raffle.findFirst({
      where: { id, guildId: { in: guildIds } },
      include: {
        eligibleRoles: true,
        winners: { where: { replaced: false }, orderBy: { position: "asc" } },
        proof: true,
        _count: { select: { participants: true } },
      },
    });
    if (!raffle) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ raffle });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
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
    const { org, user, guildIds } = await requireOrgAccess(params.org, PERMISSIONS.RAFFLE_EDIT);
    const id = Number(params.id);
    const existing = await prisma.raffle.findFirst({
      where: { id, guildId: { in: guildIds } },
      select: { id: true, status: true, messageId: true, startAt: true },
    });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (existing.status === "ENDED" || existing.status === "CANCELLED") {
      return NextResponse.json({ error: "This raffle has ended and can't be edited." }, { status: 400 });
    }

    const b = await req.json().catch(() => ({}));
    const data: Prisma.RaffleUpdateInput = {};
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

    if (str(b.projectName)) data.projectName = str(b.projectName);
    if (str(b.title)) data.title = str(b.title);
    if ("description" in b) data.description = b.description ? String(b.description) : null;
    if (Number.isInteger(b.spots) && b.spots > 0) data.spots = b.spots;
    if ("bannerUrl" in b) data.bannerUrl = b.bannerUrl ? String(b.bannerUrl) : null;
    if ("externalUrl" in b) data.externalUrl = b.externalUrl ? String(b.externalUrl) : null;
    if ("hideEntries" in b) data.hideEntries = Boolean(b.hideEntries);
    if ("requireWallet" in b) data.requireWallet = Boolean(b.requireWallet);
    if (["everyone", "here", "none"].includes(b.startPing)) data.startPing = b.startPing;
    if (b.roleMatchMode === "ALL" || b.roleMatchMode === "ANY") data.roleMatchMode = b.roleMatchMode;
    if ("announceChannelId" in b) data.announceChannelId = /^\d{5,25}$/.test(String(b.announceChannelId)) ? String(b.announceChannelId) : null;
    if ("proofChannelId" in b) data.proofChannelId = /^\d{5,25}$/.test(String(b.proofChannelId)) ? String(b.proofChannelId) : null;

    if (Array.isArray(b.walletChains)) {
      const wc = b.walletChains.filter((c: string) => CHAINS.includes(c)) as WalletChain[];
      if (wc.length) data.walletChains = wc;
    }
    if ("collectWallets" in b) data.collectWallets = Boolean(b.collectWallets);

    if (Array.isArray(b.tasks)) {
      const tasks = b.tasks
        .filter((t: { label?: string }) => t?.label && String(t.label).trim())
        .slice(0, 10)
        .map((t: { label: string; url?: string }) => ({
          label: String(t.label).trim().slice(0, 80),
          ...(t.url && /^https?:\/\//i.test(t.url) ? { url: String(t.url) } : {}),
        }));
      data.requirements = tasks.length ? { tasks } : Prisma.JsonNull;
    }

    if (b.startAt && existing.status === "UPCOMING") {
      const s = new Date(b.startAt);
      if (!isNaN(s.getTime())) data.startAt = s;
    }
    if (b.endAt) {
      const e = new Date(b.endAt);
      if (isNaN(e.getTime()) || e.getTime() <= Date.now()) {
        return NextResponse.json({ error: "End time must be in the future." }, { status: 400 });
      }
      data.endAt = e;
    }

    // Replace eligible roles if provided.
    if (Array.isArray(b.roles)) {
      const roles = b.roles
        .filter((r: { roleId?: string }) => /^\d{5,25}$/.test(String(r?.roleId)))
        .map((r: { roleId: string; roleName?: string }) => ({
          roleId: String(r.roleId),
          roleName: String(r.roleName ?? r.roleId),
        }));
      await prisma.raffleRole.deleteMany({ where: { raffleId: id } });
      data.eligibleRoles = { create: roles };
    }

    // Replace verification-task gate if provided.
    if (Array.isArray(b.verificationTaskIds)) {
      const ids = b.verificationTaskIds.filter((x: unknown) => typeof x === "string").slice(0, 20);
      const valid = ids.length
        ? await prisma.taskDefinition.findMany({
            where: { id: { in: ids }, organizationId: org.id, active: true },
            select: { id: true },
          })
        : [];
      await prisma.raffleTask.deleteMany({ where: { raffleId: id } });
      if (valid.length) {
        await prisma.raffleTask.createMany({
          data: valid.map((t) => ({ raffleId: id, taskId: t.id, required: true })),
        });
      }
    }

    // If already posted, ask the bot to re-render the embed.
    if (existing.messageId) data.editRequestedAt = new Date();

    await prisma.raffle.update({ where: { id }, data });
    await logAudit(org.id, user.id, "RAFFLE_EDIT", { targetType: "raffle", targetId: String(id) });
    return NextResponse.json({ ok: true, willRefresh: Boolean(existing.messageId) });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("raffle edit failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
