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
  // Prefer a configured brand logo; otherwise use the bot's own avatar (the KOS
  // mark) so the proof is always branded without extra setup.
  const logoUrl =
    KOS.logoUrl ?? client.user?.displayAvatarURL({ extension: "png", size: 256 }) ?? null;
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
      entryCount: raffle.entryCount,
      spots: raffle.spots,
      winners: winnerRows,
      messageLink,
      drawSeedHash: raffle.drawSeedHash,
      brandName: KOS.name,
      logoBuffer,
    }),
    renderWinnerCard({
      projectName: raffle.projectName,
      title: raffle.title,
      spots: raffle.spots,
      entryCount: raffle.entryCount,
      winners: winnerRows,
      timestamp: raffle.drawnAt ?? new Date(),
      brandName: KOS.name,
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
    create: { raffleId, messageLink, pdfPath, csvPath, cardPath },
    update: { messageLink: messageLink ?? undefined, pdfPath, csvPath, cardPath, generatedAt: new Date() },
  });

  // 4. Deliver to proof channel.
  const channelId = raffle.proofChannelId ?? raffle.announceChannelId ?? raffle.channelId;
  if (channelId) {
    const channel = await fetchTextChannel(client, channelId);
    if (channel) {
      const embed = buildProofEmbed({
        id: raffle.id,
        projectName: raffle.projectName,
        startAt: raffle.startAt,
        endAt: raffle.endAt,
        entryCount: raffle.entryCount,
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
        .catch((err) => logger.warn({ err, raffleId }, "proof delivery failed"));
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
