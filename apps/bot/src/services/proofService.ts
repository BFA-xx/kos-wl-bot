import { promises as fs } from "node:fs";
import path from "node:path";
import { type Client, AttachmentBuilder } from "discord.js";
import { prisma, LogCategory } from "@kos/db";
import { config } from "../config.js";
import { KOS } from "../theme.js";
import { logger } from "../logger.js";
import { getRaffle, fetchTextChannel } from "./raffleService.js";
import { getWinnerWallets } from "./walletService.js";
import { audit } from "./auditService.js";
import { renderProofPdf } from "../proof/pdf.js";
import { renderWinnerCard } from "../proof/card.js";
import { winnersCsv } from "../proof/csv.js";
import { buildProofEmbed } from "../embeds/proofEmbed.js";
import { encryptSecret } from "../utils/crypto.js";

function encryptedArtifact(data: Buffer): Buffer {
  return Buffer.from(encryptSecret(data.toString("base64")), "utf8");
}

/**
 * Generate the full proof package (PDF + CSV + PNG card), persist artifacts to
 * disk, record a Proof row, and deliver everything to the raffle's proof
 * channel. Idempotent enough to re-run after a reroll.
 */
export async function generateAndDeliverProof(
  client: Client,
  raffleId: number,
  messageLink: string | null,
): Promise<void> {
  const raffle = await getRaffle(raffleId);
  if (!raffle) return;

  const winnerRows = await prisma.winner.findMany({
    where: { raffleId, replaced: false },
    orderBy: { position: "asc" },
    select: { position: true, username: true, userId: true },
  });

  const walletRows = await getWinnerWallets(raffleId);
  const connection = await prisma.guildConnection.findUnique({
    where: { guildId: raffle.guildId },
    select: {
      organization: { select: { name: true, logoUrl: true } },
    },
  });
  const brandName = connection?.organization.name ?? KOS.name;
  // Prefer the community logo, then configured KOS branding, then the bot's
  // own avatar so generated proofs are always recognizably branded.
  const logoUrl =
    connection?.organization.logoUrl ??
    KOS.logoUrl ??
    client.user?.displayAvatarURL({ extension: "png", size: 256 }) ??
    null;
  const logoBuffer = await fetchLogo(logoUrl);

  // 1. Render artifacts.
  const [pdf, card] = await Promise.all([
    renderProofPdf({
      raffleId: raffle.id,
      projectName: raffle.projectName,
      title: raffle.title,
      startAt: raffle.startAt,
      endAt: raffle.endAt,
      drawnAt: raffle.drawnAt,
      roleMatchMode: raffle.roleMatchMode,
      eligibleRoles: raffle.eligibleRoles.map((r) => r.roleName),
      entryCount: raffle.hideEntries ? undefined : raffle.entryCount,
      spots: raffle.spots,
      winners: winnerRows,
      messageLink,
      drawSeedHash: raffle.drawSeedHash,
      brandName,
      logoBuffer,
    }),
    renderWinnerCard({
      projectName: raffle.projectName,
      title: raffle.title,
      spots: raffle.spots,
      entryCount: raffle.hideEntries ? undefined : raffle.entryCount,
      winners: winnerRows,
      timestamp: raffle.drawnAt ?? new Date(),
      brandName,
      logoUrl,
      raffleId: raffle.id,
      commitment: raffle.drawSeedHash,
    }),
  ]);
  const csv = winnersCsv(walletRows);

  // 2. Persist to disk.
  const dir = path.resolve(config.PROOF_OUTPUT_DIR, `raffle-${raffleId}`);
  await fs.mkdir(dir, { recursive: true });
  const pdfPath = path.join(dir, `proof-${raffleId}.pdf`);
  const csvPath = path.join(dir, `winners-${raffleId}.csv`);
  const cardPath = path.join(dir, `card-${raffleId}.png`);
  await Promise.all([
    fs.writeFile(pdfPath, pdf),
    fs.writeFile(csvPath, csv, "utf8"),
    fs.writeFile(cardPath, card),
  ]);

  // 3. Record proof row.
  await prisma.proof.upsert({
    where: { raffleId },
    create: {
      raffleId,
      messageLink,
      pdfPath,
      csvPath,
      cardPath,
      pdfData: encryptedArtifact(pdf),
      csvData: encryptedArtifact(Buffer.from(csv, "utf8")),
      cardData: encryptedArtifact(card),
      artifactsStoredAt: new Date(),
      artifactSyncAttemptedAt: new Date(),
    },
    update: {
      messageLink: messageLink ?? undefined,
      pdfPath,
      csvPath,
      cardPath,
      pdfData: encryptedArtifact(pdf),
      csvData: encryptedArtifact(Buffer.from(csv, "utf8")),
      cardData: encryptedArtifact(card),
      artifactsStoredAt: new Date(),
      artifactSyncAttemptedAt: new Date(),
      generatedAt: new Date(),
    },
  });

  // 4. Deliver to proof channel.
  const channelId =
    raffle.proofChannelId ?? raffle.announceChannelId ?? raffle.channelId;
  if (channelId) {
    const channel = await fetchTextChannel(client, channelId);
    if (channel) {
      const embed = buildProofEmbed({
        id: raffle.id,
        projectName: raffle.projectName,
        startAt: raffle.startAt,
        endAt: raffle.endAt,
        entryCount: raffle.hideEntries ? undefined : raffle.entryCount,
        winnerCount: winnerRows.length,
        messageLink,
        drawSeedHash: raffle.drawSeedHash,
      });
      if (config.DASHBOARD_URL) {
        embed.addFields({
          name: "Dashboard",
          value: `[Open raffle #${raffle.id}](${config.DASHBOARD_URL}/raffles/${raffle.id})`,
        });
      }

      const files = [
        new AttachmentBuilder(card, { name: `kos-winners-${raffleId}.png` }),
        new AttachmentBuilder(pdf, { name: `kos-proof-${raffleId}.pdf` }),
        new AttachmentBuilder(Buffer.from(csv, "utf8"), {
          name: `kos-winners-${raffleId}.csv`,
        }),
      ];
      embed.setImage(`attachment://kos-winners-${raffleId}.png`);

      await channel
        .send({ embeds: [embed], files })
        .catch((err) =>
          logger.warn({ err, raffleId }, "proof delivery failed"),
        );
    }
  }

  await audit({
    guildId: raffle.guildId,
    raffleId,
    category: LogCategory.SYSTEM,
    action: "PROOF_GENERATED",
    message: `Generated proof package for raffle #${raffleId}`,
    metadata: { winners: winnerRows.length },
  });
}

/**
 * Copy legacy EC2 proof files into PostgreSQL in small batches. This makes
 * pre-Phase-4 proof packages downloadable from Vercel without exposing the bot
 * host or requiring another shared storage credential.
 */
export async function backfillProofArtifacts(limit = 10): Promise<number> {
  const retryBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const proofs = await prisma.proof.findMany({
    where: {
      artifactsStoredAt: null,
      pdfPath: { not: null },
      csvPath: { not: null },
      cardPath: { not: null },
      OR: [
        { artifactSyncAttemptedAt: null },
        { artifactSyncAttemptedAt: { lt: retryBefore } },
      ],
    },
    select: {
      id: true,
      raffleId: true,
      pdfPath: true,
      csvPath: true,
      cardPath: true,
    },
    orderBy: { generatedAt: "asc" },
    take: Math.max(1, Math.min(50, limit)),
  });
  let stored = 0;
  for (const proof of proofs) {
    const attemptedAt = new Date();
    try {
      const [pdfData, csvData, cardData] = await Promise.all([
        fs.readFile(proof.pdfPath!),
        fs.readFile(proof.csvPath!),
        fs.readFile(proof.cardPath!),
      ]);
      await prisma.proof.update({
        where: { id: proof.id },
        data: {
          pdfData: encryptedArtifact(pdfData),
          csvData: encryptedArtifact(csvData),
          cardData: encryptedArtifact(cardData),
          artifactsStoredAt: attemptedAt,
          artifactSyncAttemptedAt: attemptedAt,
        },
      });
      stored += 1;
    } catch (err) {
      await prisma.proof
        .update({
          where: { id: proof.id },
          data: { artifactSyncAttemptedAt: attemptedAt },
        })
        .catch(() => undefined);
      logger.warn(
        { err, raffleId: proof.raffleId },
        "legacy proof artifact backfill failed",
      );
    }
  }
  return stored;
}

const logoCache = new Map<string, Buffer | null>();
async function fetchLogo(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  const cached = logoCache.get(url);
  if (cached !== undefined) return cached;
  let buf: Buffer | null = null;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`status ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    logger.warn({ err }, "failed to fetch KOS logo for proof");
    buf = null;
  }
  logoCache.set(url, buf);
  return buf;
}
