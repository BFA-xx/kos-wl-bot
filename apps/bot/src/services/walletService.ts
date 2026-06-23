import {
  type Client,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { prisma, LogCategory, WalletChain } from "@kos/db";
import { encryptSecret, decryptSecret } from "../utils/crypto.js";
import { validateWallet, chainLabel, ALL_CHAINS } from "../utils/wallets.js";
import { buildId, Actions } from "../utils/ids.js";
import { KOS } from "../theme.js";
import { audit } from "./auditService.js";
import { logger } from "../logger.js";

/**
 * Build the wallet-registration popup, pre-filled with the user's saved
 * addresses. Shared by the panel button, winner DMs, and /wallet register.
 */
export async function buildWalletProfileModal(userId: string): Promise<ModalBuilder> {
  const existing = await getWalletProfiles(userId).catch(() => []);
  const byChain = new Map(existing.map((p) => [p.chain, p.address]));

  const modal = new ModalBuilder()
    .setCustomId(buildId(Actions.SubmitWalletProfile))
    .setTitle("Register / Update Wallets");

  for (const chain of ALL_CHAINS.slice(0, 5)) {
    const input = new TextInputBuilder()
      .setCustomId(chain)
      .setLabel(`${chainLabel(chain)} address`)
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(120)
      .setPlaceholder(`Your ${chainLabel(chain)} address (optional)`);
    const saved = byChain.get(chain);
    if (saved) input.setValue(saved);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }
  return modal;
}

/** DM every winner a wallet-submission prompt. Returns count successfully DMed. */
export async function dmWinnersForWallets(
  client: Client,
  raffle: {
    id: number;
    guildId: string;
    projectName: string;
    title: string;
    walletChains: WalletChain[];
  },
  winners: { userId: string }[],
): Promise<number> {
  let delivered = 0;
  const chainText = raffle.walletChains.map(chainLabel).join(", ");

  // Winners who already registered a wallet for one of the raffle's chains are
  // already covered — skip prompting them.
  const covered = new Set(
    (
      await prisma.walletProfile.findMany({
        where: {
          userId: { in: winners.map((w) => w.userId) },
          chain: { in: raffle.walletChains },
        },
        select: { userId: true },
      })
    ).map((p) => p.userId),
  );

  for (const w of winners) {
    if (covered.has(w.userId)) continue;
    try {
      const user = await client.users.fetch(w.userId);
      const embed = new EmbedBuilder()
        .setColor(KOS.colors.white)
        .setTitle(`${KOS.emoji.trophy} You won a WL spot!`)
        .setDescription(
          [
            `**${raffle.projectName}** — ${raffle.title}`,
            "",
            `Submit your wallet to claim your whitelist spot.`,
            `Accepted: **${chainText}**`,
          ].join("\n"),
        )
        .setFooter({ text: `${KOS.footer} · Raffle #${raffle.id}` });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId(Actions.OpenWalletForm, raffle.id))
          .setLabel("Submit Wallet")
          .setStyle(ButtonStyle.Secondary),
      );

      await user.send({ embeds: [embed], components: [row] });
      delivered++;
    } catch (err) {
      logger.warn({ err, userId: w.userId }, "could not DM winner (DMs closed?)");
    }
  }

  await audit({
    guildId: raffle.guildId,
    raffleId: raffle.id,
    category: LogCategory.WALLET,
    action: "WALLET_DM_SENT",
    message: `Sent wallet forms to ${delivered}/${winners.length} winners`,
  });

  return delivered;
}

export interface RecordWalletResult {
  ok: boolean;
  error?: string;
}

/** Validate and store a winner's wallet address (encrypted at rest). */
export async function recordWallet(params: {
  raffleId: number;
  userId: string;
  username: string;
  chain: WalletChain;
  address: string;
}): Promise<RecordWalletResult> {
  const validation = validateWallet(params.chain, params.address);
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }

  const winner = await prisma.winner.findFirst({
    where: { raffleId: params.raffleId, userId: params.userId, replaced: false },
    select: { id: true, raffle: { select: { guildId: true } } },
  });
  if (!winner) {
    return { ok: false, error: "You are not a current winner of this raffle." };
  }

  const stored = encryptSecret(validation.normalized!);

  await prisma.wallet.upsert({
    where: { winnerId: winner.id },
    create: {
      winnerId: winner.id,
      userId: params.userId,
      chain: params.chain,
      address: stored,
    },
    update: { chain: params.chain, address: stored, submittedAt: new Date() },
  });

  await audit({
    guildId: winner.raffle.guildId,
    raffleId: params.raffleId,
    category: LogCategory.WALLET,
    action: "WALLET_SUBMIT",
    message: `${params.username} submitted a ${chainLabel(params.chain)} wallet`,
    actorId: params.userId,
  });

  return { ok: true };
}

/** Decrypted winner+wallet rows for export. Falls back to the winner's saved
 *  wallet profile (self-registered) when no raffle-specific wallet was submitted,
 *  so hosts/teams still receive on-file addresses automatically. */
export async function getWinnerWallets(raffleId: number) {
  const [raffle, winners] = await Promise.all([
    prisma.raffle.findUnique({ where: { id: raffleId }, select: { walletChains: true } }),
    prisma.winner.findMany({
      where: { raffleId, replaced: false },
      orderBy: { position: "asc" },
      include: { wallet: true },
    }),
  ]);

  const chains = raffle?.walletChains ?? [];
  const userIds = winners.map((w) => w.userId);
  const profiles = userIds.length
    ? await prisma.walletProfile.findMany({ where: { userId: { in: userIds } } })
    : [];

  const pickProfile = (userId: string) => {
    const owned = profiles.filter((p) => p.userId === userId);
    // Prefer a profile that matches one of the raffle's chains, else any.
    for (const c of chains) {
      const hit = owned.find((p) => p.chain === c);
      if (hit) return hit;
    }
    return owned[0] ?? null;
  };

  return winners.map((w) => {
    if (w.wallet) {
      return {
        position: w.position,
        userId: w.userId,
        username: w.username,
        chain: w.wallet.chain as string,
        address: safeDecrypt(w.wallet.address),
        submittedAt: w.wallet.submittedAt as Date | null,
        source: "submitted" as const,
      };
    }
    const profile = pickProfile(w.userId);
    return {
      position: w.position,
      userId: w.userId,
      username: w.username,
      chain: profile ? (profile.chain as string) : null,
      address: profile ? safeDecrypt(profile.address) : null,
      submittedAt: profile?.updatedAt ?? null,
      source: profile ? ("profile" as const) : ("none" as const),
    };
  });
}

// ---------------------------------------------------------------------------
// Self-serve wallet registry (reusable across raffles)
// ---------------------------------------------------------------------------

export async function upsertWalletProfile(params: {
  userId: string;
  username: string;
  chain: WalletChain;
  address: string;
}): Promise<RecordWalletResult> {
  const validation = validateWallet(params.chain, params.address);
  if (!validation.valid) return { ok: false, error: validation.error };

  await prisma.user.upsert({
    where: { id: params.userId },
    create: { id: params.userId, username: params.username },
    update: { username: params.username },
  });

  await prisma.walletProfile.upsert({
    where: { userId_chain: { userId: params.userId, chain: params.chain } },
    create: {
      userId: params.userId,
      chain: params.chain,
      address: encryptSecret(validation.normalized!),
    },
    update: { address: encryptSecret(validation.normalized!) },
  });

  return { ok: true };
}

export async function getWalletProfiles(userId: string) {
  const rows = await prisma.walletProfile.findMany({
    where: { userId },
    orderBy: { chain: "asc" },
  });
  return rows.map((r) => ({
    chain: r.chain,
    address: safeDecrypt(r.address),
    updatedAt: r.updatedAt,
  }));
}

export async function removeWalletProfile(
  userId: string,
  chain: WalletChain,
): Promise<boolean> {
  const existing = await prisma.walletProfile.findUnique({
    where: { userId_chain: { userId, chain } },
  });
  if (!existing) return false;
  await prisma.walletProfile.delete({ where: { id: existing.id } });
  return true;
}

/** All registered wallet profiles (decrypted) — for moderator/team export. */
export async function exportAllWalletProfiles() {
  const rows = await prisma.walletProfile.findMany({
    orderBy: [{ userId: "asc" }, { chain: "asc" }],
    include: { user: { select: { username: true } } },
  });
  return rows.map((r) => ({
    userId: r.userId,
    username: r.user.username,
    chain: r.chain as string,
    address: safeDecrypt(r.address),
    updatedAt: r.updatedAt,
  }));
}

function safeDecrypt(value: string): string {
  try {
    return decryptSecret(value);
  } catch (err) {
    logger.error({ err }, "wallet decrypt failed");
    return "[decrypt-error]";
  }
}
