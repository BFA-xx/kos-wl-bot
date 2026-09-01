import type { Context } from "grammy";
import type { User as TelegramUser } from "grammy/types";
import type { Prisma } from "@prisma/client";
import { hashIntegrationToken, telegramDisplayName } from "@kos/db";
import { prisma } from "@/lib/db";
import { dashboardOrigin } from "@/lib/telegram/format";

export interface TelegramIdentitySummary {
  id: string;
  displayName: string;
  status: "ACTIVE" | "SUSPENDED";
  onboardingStatus: "STARTED" | "PROFILE_COMPLETE" | "COMPLETED";
  legacyUserId: string | null;
  isNew: boolean;
}

function telegramAccountData(user: TelegramUser, now: Date) {
  return {
    username: user.username ?? null,
    displayName: telegramDisplayName(user),
    firstName: user.first_name,
    lastName: user.last_name ?? null,
    verifiedAt: now,
    lastSeenAt: now,
    metadata: { languageCode: user.language_code ?? null },
  } satisfies Prisma.IdentityAccountUpdateInput;
}

export async function syncTelegramIdentity(
  tx: Prisma.TransactionClient,
  user: TelegramUser,
  legacyUserId: string | null,
): Promise<TelegramIdentitySummary> {
  const now = new Date();
  const externalId = String(user.id);
  const accountData = telegramAccountData(user, now);
  const existingAccount = await tx.identityAccount.findUnique({
    where: {
      provider_externalId: { provider: "TELEGRAM", externalId },
    },
    include: { identity: true },
  });
  const linkedIdentity = legacyUserId
    ? await tx.kosIdentity.findUnique({ where: { legacyUserId } })
    : null;

  if (existingAccount) {
    const currentIdentity = existingAccount.identity;
    if (
      currentIdentity.legacyUserId &&
      legacyUserId &&
      currentIdentity.legacyUserId !== legacyUserId
    ) {
      throw new Error("Telegram identity is linked to another KOS account");
    }

    let identityId = currentIdentity.id;
    if (linkedIdentity && linkedIdentity.id !== currentIdentity.id) {
      const conflict = await tx.identityAccount.findUnique({
        where: {
          identityId_provider: {
            identityId: linkedIdentity.id,
            provider: "TELEGRAM",
          },
        },
      });
      if (conflict && conflict.id !== existingAccount.id) {
        throw new Error("KOS account already has another Telegram identity");
      }
      await tx.identityAccount.update({
        where: { id: existingAccount.id },
        data: { identityId: linkedIdentity.id, ...accountData },
      });
      const remaining = await tx.identityAccount.count({
        where: { identityId: currentIdentity.id },
      });
      if (remaining === 0 && !currentIdentity.legacyUserId) {
        await tx.kosIdentity.delete({ where: { id: currentIdentity.id } });
      }
      identityId = linkedIdentity.id;
    } else {
      await tx.identityAccount.update({
        where: { id: existingAccount.id },
        data: accountData,
      });
    }

    const identity = await tx.kosIdentity.update({
      where: { id: identityId },
      data: {
        displayName: accountData.displayName,
        legacyUserId: legacyUserId ?? undefined,
        onboardingStatus: legacyUserId ? "COMPLETED" : undefined,
      },
    });
    return { ...identity, isNew: false };
  }

  if (linkedIdentity) {
    await tx.identityAccount.create({
      data: {
        identityId: linkedIdentity.id,
        provider: "TELEGRAM",
        externalId,
        ...accountData,
      },
    });
    const identity = await tx.kosIdentity.update({
      where: { id: linkedIdentity.id },
      data: {
        displayName: accountData.displayName,
        onboardingStatus: legacyUserId ? "COMPLETED" : undefined,
      },
    });
    return { ...identity, isNew: false };
  }

  const identity = await tx.kosIdentity.create({
    data: {
      displayName: accountData.displayName,
      legacyUserId,
      onboardingStatus: legacyUserId ? "COMPLETED" : "STARTED",
      accounts: {
        create: {
          provider: "TELEGRAM",
          externalId,
          ...accountData,
        },
      },
    },
  });
  return { ...identity, isNew: true };
}

export async function ensureTelegramIdentity(
  user: TelegramUser,
): Promise<TelegramIdentitySummary> {
  const connected = await prisma.connectedAccount.findUnique({
    where: {
      provider_externalId: {
        provider: "TELEGRAM",
        externalId: String(user.id),
      },
    },
    select: { userId: true },
  });
  return prisma.$transaction((tx) =>
    syncTelegramIdentity(tx, user, connected?.userId ?? null),
  );
}

export async function linkTelegramAccount(
  ctx: Context,
  secret: string,
): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") return;
  const from = ctx.from;
  const now = new Date();
  const tokenHash = hashIntegrationToken(secret);
  const telegramUserId = String(from.id);
  const displayName = telegramDisplayName(from);

  const outcome = await prisma.$transaction(async (tx) => {
    const token = await tx.integrationActionToken.findUnique({
      where: { tokenHash },
    });
    if (
      !token ||
      token.action !== "TELEGRAM_LINK" ||
      !token.userId ||
      token.expiresAt <= now ||
      token.consumedAt
    ) {
      return "expired" as const;
    }
    const claimed = await tx.integrationActionToken.updateMany({
      where: { id: token.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claimed.count === 0) return "expired" as const;
    const taken = await tx.connectedAccount.findUnique({
      where: {
        provider_externalId: {
          provider: "TELEGRAM",
          externalId: telegramUserId,
        },
      },
      select: { userId: true },
    });
    if (taken && taken.userId !== token.userId) return "taken" as const;
    await tx.connectedAccount.upsert({
      where: {
        userId_provider: { userId: token.userId, provider: "TELEGRAM" },
      },
      create: {
        userId: token.userId,
        provider: "TELEGRAM",
        externalId: telegramUserId,
        handle: from.username ?? null,
        displayName,
        verifiedAt: now,
        lastSeenAt: now,
        metadata: { source: "telegram_deep_link" },
      },
      update: {
        externalId: telegramUserId,
        handle: from.username ?? null,
        displayName,
        verifiedAt: now,
        lastSeenAt: now,
      },
    });
    await syncTelegramIdentity(tx, from, token.userId);
    return "linked" as const;
  });

  if (outcome === "expired") {
    await ctx.reply(
      "This KOS linking request has expired. Start a new one from your KOS profile.",
    );
  } else if (outcome === "taken") {
    await ctx.reply(
      "This Telegram account is already linked to another KOS account.",
    );
  } else {
    await ctx.reply(
      "Onboarding complete. Telegram is connected to KOS, and you can now enter eligible raffles. Connect a wallet only when a raffle requires one.",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Open KOS profile", url: `${dashboardOrigin()}/me` }],
          ],
        },
      },
    );
  }
}
