import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  AccessError,
  requireOrgAccess,
  guildScope,
  logAudit,
} from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import type { Prisma, RaffleStatus, WalletChain } from "@prisma/client";
import { sanitizeHttpUrl, sanitizeLegacyRaffleTasks } from "@/lib/raffle-input";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CHAINS = ["ETHEREUM", "BASE", "SOLANA", "BITCOIN"];

export async function GET(
  req: NextRequest,
  { params }: { params: { org: string } },
) {
  try {
    const { guildIds } = await requireOrgAccess(params.org);
    const status = req.nextUrl.searchParams.get("status");
    const q = req.nextUrl.searchParams.get("q")?.trim();
    const parsedId =
      q && /^#?\d+$/.test(q) ? Number(q.replace(/^#/, "")) : null;
    const numericId =
      parsedId &&
      Number.isSafeInteger(parsedId) &&
      parsedId > 0 &&
      parsedId <= 2147483647
        ? parsedId
        : null;
    const search: Prisma.RaffleWhereInput | undefined = q
      ? {
          OR: [
            ...(numericId ? [{ id: numericId }] : []),
            { projectName: { contains: q, mode: "insensitive" } },
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined;
    const raffles = await prisma.raffle.findMany({
      where: {
        ...guildScope(guildIds),
        ...(status ? { status: status as RaffleStatus } : {}),
        ...(search ?? {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ raffles });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * Create a raffle from the dashboard. Written as status DRAFT with a channel —
 * the bot's scheduler posts it to Discord (the dashboard can't reach the bot
 * directly, so this is DB-mediated).
 */
export async function POST(
  req: Request,
  { params }: { params: { org: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.RAFFLE_CREATE,
    );
    const b = await req.json().catch(() => ({}));

    const guildId = String(b.guildId ?? "");
    if (!guildIds.includes(guildId)) {
      return NextResponse.json(
        { error: "That server isn't connected to this org." },
        { status: 403 },
      );
    }
    const guildDefaults = await prisma.guild.findUnique({
      where: { id: guildId },
      select: {
        defaultRaffleChannelId: true,
        defaultAnnounceChannelId: true,
        defaultProofChannelId: true,
      },
    });
    const requestedChannelId =
      typeof b.channelId === "string" ? b.channelId.trim() : "";
    const channelId =
      requestedChannelId || guildDefaults?.defaultRaffleChannelId || "";
    if (!/^\d{5,25}$/.test(channelId)) {
      return NextResponse.json(
        {
          error:
            "Pick a valid raffle post channel, or configure one in Settings.",
        },
        { status: 400 },
      );
    }
    const inScope = (id: unknown) =>
      typeof id === "string" && /^\d{5,25}$/.test(id) ? id : null;
    const announceChannelId =
      "announceChannelId" in b
        ? inScope(b.announceChannelId)
        : guildDefaults?.defaultAnnounceChannelId ?? null;
    const proofChannelId =
      "proofChannelId" in b
        ? inScope(b.proofChannelId)
        : guildDefaults?.defaultProofChannelId ?? null;
    const projectName = String(b.projectName ?? "").trim();
    const title = String(b.title ?? "").trim();
    const spots = Number(b.spots);
    if (!projectName || !title) {
      return NextResponse.json(
        { error: "Project name and title are required." },
        { status: 400 },
      );
    }
    if (!Number.isInteger(spots) || spots < 1) {
      return NextResponse.json(
        { error: "Spots must be a positive whole number." },
        { status: 400 },
      );
    }

    const now = Date.now();
    const startAt = b.startAt ? new Date(b.startAt) : new Date(now);
    const endAt = new Date(b.endAt);
    if (isNaN(endAt.getTime()) || endAt.getTime() <= now) {
      return NextResponse.json(
        { error: "End time must be in the future." },
        { status: 400 },
      );
    }
    if (endAt.getTime() <= startAt.getTime()) {
      return NextResponse.json(
        { error: "End must be after start." },
        { status: 400 },
      );
    }

    const walletChains = (
      Array.isArray(b.walletChains) ? b.walletChains : ["ETHEREUM"]
    ).filter((c: string) => CHAINS.includes(c)) as WalletChain[];
    const roles = (Array.isArray(b.roles) ? b.roles : [])
      .filter((r: { roleId?: string; roleName?: string }) => r?.roleId)
      .map((r: { roleId: string; roleName?: string }) => ({
        roleId: String(r.roleId),
        roleName: String(r.roleName ?? r.roleId),
      }));

    // Social / off-platform tasks (label + optional URL) → requirements.tasks.
    const tasks = sanitizeLegacyRaffleTasks(b.tasks);

    // Verification tasks (Task Engine) — must belong to this org.
    const taskIds: string[] = Array.isArray(b.verificationTaskIds)
      ? b.verificationTaskIds
          .filter((x: unknown) => typeof x === "string")
          .slice(0, 20)
      : [];
    const validTasks = taskIds.length
      ? await prisma.taskDefinition.findMany({
          where: { id: { in: taskIds }, organizationId: org.id, active: true },
          select: { id: true },
        })
      : [];

    const raffle = await prisma.raffle.create({
      data: {
        guildId,
        channelId,
        announceChannelId,
        proofChannelId,
        requirements: tasks.length
          ? ({ tasks } as unknown as Prisma.InputJsonValue)
          : undefined,
        projectName,
        title,
        description: b.description ? String(b.description) : null,
        spots,
        roleMatchMode: b.roleMatchMode === "ALL" ? "ALL" : "ANY",
        status: "DRAFT", // bot scheduler posts it, then sets LIVE/UPCOMING
        startAt,
        endAt,
        startPing: ["everyone", "here", "none"].includes(b.startPing)
          ? b.startPing
          : "everyone",
        hideEntries: Boolean(b.hideEntries),
        requireWallet: Boolean(b.requireWallet),
        useRoleWeights: Boolean(b.useRoleWeights),
        collectWallets: b.collectWallets !== false,
        walletChains: walletChains.length ? walletChains : ["ETHEREUM"],
        bannerUrl: b.bannerUrl ? String(b.bannerUrl) : null,
        externalUrl: sanitizeHttpUrl(b.externalUrl),
        createdById: user.id,
        createdByName: user.globalName ?? user.username,
        createdByAvatar: user.avatarUrl,
        eligibleRoles: roles.length ? { create: roles } : undefined,
      },
    });
    if (validTasks.length) {
      await prisma.raffleTask.createMany({
        data: validTasks.map((t) => ({
          raffleId: raffle.id,
          taskId: t.id,
          required: true,
        })),
      });
    }
    await logAudit(org.id, user.id, "RAFFLE_CREATE", {
      targetType: "raffle",
      targetId: String(raffle.id),
    });

    return NextResponse.json({ id: raffle.id });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("raffle create failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
