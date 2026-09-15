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
import {
  validateWallet,
  chainLabel,
  ALL_CHAINS,
  EVM_CHAINS,
  EVM_FIELD_ID,
  MAX_ADDRESS_LENGTH,
  selectConfiguredWallet,
  walletFamily,
} from "../utils/wallets.js";
import { buildId, Actions } from "../utils/ids.js";
import { KOS } from "../theme.js";
import { audit } from "./auditService.js";
import { logger } from "../logger.js";

/** The member's current EVM address: their first EVM profile in display order. */
export function currentEvmAddress(
  profiles: readonly { chain: WalletChain; address: string }[],
): string | undefined {
  const byChain = new Map(profiles.map((p) => [p.chain, p.address]));
  for (const chain of EVM_CHAINS) {
    const saved = byChain.get(chain);
    if (saved) return saved;
  }
  return undefined;
}

/**
 * Build the wallet-registration popup, pre-filled with the user's saved
 * addresses. Shared by the panel button, winner DMs, and /wallet register.
 *
 * A Discord modal holds five inputs and there are far more than five chains,
 * so every EVM network shares one `0x` field — the submit handler fans it out
 * to all of them — and the non-EVM families get a field each.
 */
export async function buildWalletProfileModal(
  userId: string,
): Promise<ModalBuilder> {
  const existing = await getWalletProfiles(userId).catch(() => []);
  const byChain = new Map(existing.map((p) => [p.chain, p.address]));

  const modal = new ModalBuilder()
    .setCustomId(buildId(Actions.SubmitWalletProfile))
    .setTitle("Register / Update Wallets");

  const evm = new TextInputBuilder()
    .setCustomId(EVM_FIELD_ID)
    .setLabel("EVM address (Ethereum, Base, RH, Ink, Arc…)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(MAX_ADDRESS_LENGTH)
    .setPlaceholder(
      `0x… — saved for all ${EVM_CHAINS.length} EVM networks (optional)`,
    );
  const savedEvm = currentEvmAddress(existing);
  if (savedEvm) evm.setValue(savedEvm);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(evm),
  );

  const nonEvm = ALL_CHAINS.filter((chain) => walletFamily(chain) !== "EVM");
  for (const chain of nonEvm.slice(0, 4)) {
    const input = new TextInputBuilder()
      .setCustomId(chain)
      .setLabel(`${chainLabel(chain)} address`)
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(MAX_ADDRESS_LENGTH)
      .setPlaceholder(`Your ${chainLabel(chain)} address (optional)`);
    const saved = byChain.get(chain);
    if (saved) input.setValue(saved);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input),
    );
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
      logger.warn(
        { err, userId: w.userId },
        "could not DM winner (DMs closed?)",
      );
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
    where: {
      raffleId: params.raffleId,
      userId: params.userId,
      replaced: false,
    },
    select: {
      id: true,
      raffle: {
        select: {
          guildId: true,
          walletChains: true,
          holdResults: true,
          resultsPublishedAt: true,
        },
      },
    },
  });
  if (!winner) {
    return { ok: false, error: "You are not a current winner of this raffle." };
  }
  if (winner.raffle.holdResults && !winner.raffle.resultsPublishedAt) {
    return {
      ok: false,
      error: "The team is still reviewing this raffle's results.",
    };
  }
  if (
    winner.raffle.walletChains.length > 0 &&
    !winner.raffle.walletChains.includes(params.chain)
  ) {
    return {
      ok: false,
      error: `This raffle accepts ${winner.raffle.walletChains.map(chainLabel).join(" or ")} wallets.`,
    };
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

/** Decrypted winner+wallet rows for export. A saved profile may only satisfy a
 * raffle when its chain is one of that raffle's configured wallet chains. */
export async function getWinnerWallets(raffleId: number) {
  const [raffle, winners] = await Promise.all([
    prisma.raffle.findUnique({
      where: { id: raffleId },
      select: { walletChains: true },
    }),
    prisma.winner.findMany({
      where: { raffleId, replaced: false },
      orderBy: { position: "asc" },
      include: { wallet: true },
    }),
  ]);

  const chains = raffle?.walletChains ?? [];
  const userIds = winners.map((w) => w.userId);
  const profiles = userIds.length
    ? await prisma.walletProfile.findMany({
        where: { userId: { in: userIds } },
      })
    : [];

  return winners.map((w) => {
    const source = selectConfiguredWallet(
      w.wallet,
      profiles.filter((profile) => profile.userId === w.userId),
      chains,
    );
    const submitted = source !== null && source === w.wallet;
    const profile = submitted
      ? null
      : (profiles.find((item) => item === source) ?? null);
    return {
      position: w.position,
      userId: w.userId,
      username: w.username,
      chain: source ? (source.chain as string) : null,
      address: source ? safeDecrypt(source.address) : null,
      submittedAt: source
        ? submitted
          ? (w.wallet?.submittedAt ?? null)
          : (profile?.updatedAt ?? null)
        : null,
      source: source
        ? submitted
          ? ("submitted" as const)
          : ("profile" as const)
        : ("none" as const),
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

/**
 * Save one `0x` address to every EVM chain at once. With `onlyMissing`, chains
 * that already hold an address keep it — used when the modal comes back with
 * the pre-filled EVM value untouched, so a per-network override survives while
 * newly added networks still get filled in.
 */
export async function upsertEvmWalletProfiles(params: {
  userId: string;
  username: string;
  address: string;
  onlyMissing?: boolean;
}): Promise<RecordWalletResult & { chains?: WalletChain[] }> {
  const validation = validateWallet(WalletChain.ETHEREUM, params.address);
  if (!validation.valid) return { ok: false, error: validation.error };

  await prisma.user.upsert({
    where: { id: params.userId },
    create: { id: params.userId, username: params.username },
    update: { username: params.username },
  });

  let chains = EVM_CHAINS;
  if (params.onlyMissing) {
    const held = await prisma.walletProfile.findMany({
      where: { userId: params.userId, chain: { in: EVM_CHAINS } },
      select: { chain: true },
    });
    const heldSet = new Set(held.map((row) => row.chain));
    chains = EVM_CHAINS.filter((chain) => !heldSet.has(chain));
  }
  if (chains.length === 0) return { ok: true, chains };

  const stored = encryptSecret(validation.normalized!);
  await prisma.$transaction(
    chains.map((chain) =>
      prisma.walletProfile.upsert({
        where: { userId_chain: { userId: params.userId, chain } },
        create: { userId: params.userId, chain, address: stored },
        update: { address: stored },
      }),
    ),
  );
  return { ok: true, chains };
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
