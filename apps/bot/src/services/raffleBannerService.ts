import { prisma } from "@kos/db";
import { config } from "../config.js";

const MAX_BANNER_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const DISCORD_MEDIA_HOSTS = new Set([
  "cdn.discordapp.com",
  "media.discordapp.net",
]);

export function isDiscordAttachmentUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      DISCORD_MEDIA_HOSTS.has(url.hostname.toLowerCase()) &&
      /^\/(?:ephemeral-)?attachments\//u.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function durableRaffleBannerUrl(
  dashboardUrl: string,
  raffleId: number,
  version: number,
): string {
  return `${dashboardUrl.replace(/\/+$/u, "")}/r/${raffleId}/banner?v=${version}`;
}

async function readBoundedImage(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BANNER_BYTES) {
    throw new Error("Banner image exceeds the 5 MB limit.");
  }
  if (!response.body) throw new Error("Banner response was empty.");

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BANNER_BYTES) {
        await reader.cancel();
        throw new Error("Banner image exceeds the 5 MB limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new Error("Banner response was empty.");
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    size,
  );
}

/**
 * Copy a Discord interaction attachment into shared durable storage before the
 * raffle post is published. External and existing durable URLs pass through.
 */
export async function persistDiscordRaffleBanner(
  raffleId: number,
  sourceUrl: string | null,
): Promise<string | null> {
  if (!sourceUrl || !isDiscordAttachmentUrl(sourceUrl)) return sourceUrl;
  if (!config.DASHBOARD_URL) {
    throw new Error("DASHBOARD_URL is required to persist Discord banners.");
  }

  const response = await fetch(sourceUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`Discord banner download failed with ${response.status}.`);
  }
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new Error("Discord banner is not a supported image type.");
  }
  const data = await readBoundedImage(response);
  const storedAt = Date.now();
  const publicUrl = durableRaffleBannerUrl(
    config.DASHBOARD_URL,
    raffleId,
    storedAt,
  );

  await prisma.$transaction([
    prisma.raffleBannerAsset.upsert({
      where: { raffleId },
      create: {
        raffleId,
        sourceUrl,
        contentType,
        byteLength: data.byteLength,
        data,
      },
      update: {
        sourceUrl,
        contentType,
        byteLength: data.byteLength,
        data,
      },
    }),
    prisma.raffle.update({
      where: { id: raffleId },
      data: { bannerUrl: publicUrl },
    }),
  ]);
  return publicUrl;
}
