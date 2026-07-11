import { NextResponse, type NextRequest } from "next/server";
import { Prisma, type WalletChain } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import {
  duplicateSchedule,
  duplicateSourceWhere,
  duplicateTitle,
  parseDuplicateVariant,
} from "@/lib/raffle-duplication";
import { parsePublicRaffleId } from "@/lib/raffle-share";
import { sanitizeHttpUrl, sanitizeLegacyRaffleTasks } from "@/lib/raffle-input";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CHAINS = ["ETHEREUM", "BASE", "SOLANA", "BITCOIN"];

const sourceInclude = {
  eligibleRoles: { orderBy: { id: "asc" as const } },
  RaffleTask: { orderBy: { id: "asc" as const } },
} satisfies Prisma.RaffleInclude;

async function sourceRaffle(id: number, guildIds: string[]) {
  return prisma.raffle.findFirst({
    where: duplicateSourceWhere(id, guildIds),
    include: sourceInclude,
  });
}

/** Configuration-only blueprint used to prefill the existing raffle builder. */
export async function GET(
  req: NextRequest,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.RAFFLE_CREATE,
    );
    const id = parsePublicRaffleId(params.id);
    if (!id) {
      return NextResponse.json({ error: "Invalid raffle id." }, { status: 400 });
    }
    const source = await sourceRaffle(id, guildIds);
    if (!source) {
      return NextResponse.json({ error: "Raffle not found." }, { status: 404 });
    }

    const variant = parseDuplicateVariant(
      req.nextUrl.searchParams.get("variant"),
    );
    const schedule = duplicateSchedule(source.startAt, source.endAt);
    const requirements = (source.requirements ?? {}) as Record<string, unknown>;

    return NextResponse.json({
      blueprint: {
        sourceRaffleId: source.id,
        guildId: source.guildId,
        channelId: source.channelId ?? "",
        announceChannelId: source.announceChannelId ?? "",
        proofChannelId: source.proofChannelId ?? "",
        projectName: source.projectName,
        title: duplicateTitle(source.title, variant),
        description: source.description ?? "",
        spots: source.spots,
        roleMatchMode: source.roleMatchMode,
        startAt: schedule.startAt.toISOString(),
        endAt: schedule.endAt.toISOString(),
        scheduled: false,
        startPing: source.startPing,
        hideEntries: source.hideEntries,
        collectWallets: source.collectWallets,
        requireWallet: source.requireWallet,
        useRoleWeights: source.useRoleWeights,
        walletChains: source.walletChains,
        bannerUrl: source.bannerUrl ?? "",
        externalUrl: source.externalUrl ?? "",
        tasks: sanitizeLegacyRaffleTasks(requirements.tasks).map((task) => ({
          label: task.label,
          url: task.url ?? "",
        })),
        roles: source.eligibleRoles.map((role) => ({
          roleId: role.roleId,
          roleName: role.roleName,
        })),
        verificationTaskIds: source.RaffleTask.map((task) => task.taskId),
      },
    });
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("raffle duplicate blueprint failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** Create a fresh raffle from a source configuration plus reviewed overrides. */
export async function POST(
  req: NextRequest,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.RAFFLE_CREATE,
    );
    const id = parsePublicRaffleId(params.id);
    if (!id) {
      return NextResponse.json({ error: "Invalid raffle id." }, { status: 400 });
    }
    const source = await sourceRaffle(id, guildIds);
    if (!source) {
      return NextResponse.json({ error: "Raffle not found." }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const projectName = String(body.projectName ?? source.projectName).trim();
    const variant = parseDuplicateVariant(
      req.nextUrl.searchParams.get("variant"),
    );
    const title = String(
      body.title ?? duplicateTitle(source.title, variant),
    ).trim();
    const spots = Number(body.spots ?? source.spots);
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

    const fallbackSchedule = duplicateSchedule(source.startAt, source.endAt);
    const startAt = body.startAt ? new Date(body.startAt) : fallbackSchedule.startAt;
    const endAt = body.endAt ? new Date(body.endAt) : fallbackSchedule.endAt;
    if (
      Number.isNaN(startAt.getTime()) ||
      Number.isNaN(endAt.getTime()) ||
      endAt.getTime() <= Date.now() ||
      endAt.getTime() <= startAt.getTime()
    ) {
      return NextResponse.json(
        { error: "Choose a valid future schedule with end after start." },
        { status: 400 },
      );
    }

    const requestedChannel = String(body.channelId ?? source.channelId ?? "").trim();
    if (!/^\d{5,25}$/u.test(requestedChannel)) {
      return NextResponse.json(
        { error: "Choose a valid raffle post channel." },
        { status: 400 },
      );
    }
    const optionalChannel = (value: unknown, fallback: string | null) => {
      const candidate = String(value ?? fallback ?? "").trim();
      return /^\d{5,25}$/u.test(candidate) ? candidate : null;
    };

    const roles = Array.isArray(body.roles)
      ? (body.roles as { roleId?: unknown; roleName?: unknown }[])
          .filter((role) => /^\d{5,25}$/u.test(String(role.roleId)))
          .map((role) => ({
            roleId: String(role.roleId),
            roleName: String(role.roleName ?? role.roleId),
          }))
      : source.eligibleRoles.map((role) => ({
          roleId: role.roleId,
          roleName: role.roleName,
        }));
    const uniqueRoles = [...new Map(roles.map((role) => [role.roleId, role])).values()];

    const requestedTaskIds = Array.isArray(body.verificationTaskIds)
      ? (body.verificationTaskIds as unknown[]).filter(
          (value): value is string => typeof value === "string",
        )
      : source.RaffleTask.map((task) => task.taskId);
    const validTasks = requestedTaskIds.length
      ? await prisma.taskDefinition.findMany({
          where: {
            id: { in: [...new Set(requestedTaskIds)].slice(0, 20) },
            organizationId: org.id,
            active: true,
          },
          select: { id: true },
        })
      : [];

    const requirements = {
      ...((source.requirements ?? {}) as Record<string, unknown>),
    };
    if (Array.isArray(body.tasks)) {
      const tasks = sanitizeLegacyRaffleTasks(body.tasks);
      if (tasks.length) requirements.tasks = tasks;
      else delete requirements.tasks;
    }

    const walletChains = (
      Array.isArray(body.walletChains)
        ? body.walletChains
        : source.walletChains
    ).filter((chain: string) => CHAINS.includes(chain)) as WalletChain[];

    const duplicate = await prisma.$transaction(async (tx) => {
      const created = await tx.raffle.create({
        data: {
          guildId: source.guildId,
          channelId: requestedChannel,
          announceChannelId: optionalChannel(
            body.announceChannelId,
            source.announceChannelId,
          ),
          proofChannelId: optionalChannel(
            body.proofChannelId,
            source.proofChannelId,
          ),
          projectName,
          title,
          description:
            "description" in body
              ? body.description
                ? String(body.description)
                : null
              : source.description,
          spots,
          roleMatchMode:
            body.roleMatchMode === "ALL" ||
            (body.roleMatchMode === undefined && source.roleMatchMode === "ALL")
              ? "ALL"
              : "ANY",
          status: "DRAFT",
          startAt,
          endAt,
          startPing: ["everyone", "here", "none"].includes(body.startPing)
            ? body.startPing
            : source.startPing,
          hideEntries:
            "hideEntries" in body
              ? Boolean(body.hideEntries)
              : source.hideEntries,
          collectWallets:
            "collectWallets" in body
              ? body.collectWallets !== false
              : source.collectWallets,
          requireWallet:
            "requireWallet" in body
              ? Boolean(body.requireWallet)
              : source.requireWallet,
          useRoleWeights:
            "useRoleWeights" in body
              ? Boolean(body.useRoleWeights)
              : source.useRoleWeights,
          walletChains: walletChains.length ? walletChains : source.walletChains,
          bannerUrl:
            "bannerUrl" in body
              ? sanitizeHttpUrl(body.bannerUrl)
              : source.bannerUrl,
          externalUrl:
            "externalUrl" in body
              ? sanitizeHttpUrl(body.externalUrl)
              : source.externalUrl,
          requirements: Object.keys(requirements).length
            ? (requirements as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          createdById: user.id,
          createdByName: user.globalName ?? user.username,
          createdByAvatar: user.avatarUrl,
          eligibleRoles: uniqueRoles.length
            ? { create: uniqueRoles }
            : undefined,
        },
      });
      if (validTasks.length) {
        await tx.raffleTask.createMany({
          data: validTasks.map((task) => ({
            raffleId: created.id,
            taskId: task.id,
            required: true,
          })),
        });
      }
      return created;
    });

    await logAudit(org.id, user.id, "RAFFLE_DUPLICATE", {
      targetType: "raffle",
      targetId: String(duplicate.id),
      metadata: { sourceRaffleId: source.id, variant },
    });

    return NextResponse.json({ id: duplicate.id, sourceRaffleId: source.id });
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("raffle duplicate failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
