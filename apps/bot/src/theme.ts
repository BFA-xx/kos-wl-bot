import { config } from "./config.js";

/**
 * KOS brand system — premium, minimal, NFT-native. Black background,
 * white typography, silver/grey accents. No bright colors.
 */
export const KOS = {
  name: config.KOS_BRAND_NAME,
  logoUrl: config.KOS_LOGO_URL,
  footer: "Powered by KOS",

  colors: {
    // Discord renders embeds on a dark surface; near-black keeps the bar subtle.
    black: 0x0a0a0a,
    white: 0xffffff,
    silver: 0xc0c0c0,
    grey: 0x2b2b2b,
    // Subtle state tints (kept muted, no neon).
    live: 0xe5e5e5,
    upcoming: 0x8a8a8a,
    ended: 0x4a4a4a,
    success: 0xb8b8b8,
    danger: 0x6e6e6e,
  },

  emoji: {
    live: "🟢",
    upcoming: "⚪",
    ended: "⚫",
    spot: "◆",
    role: "▸",
    clock: "⏱",
    trophy: "🏆",
    check: "✅",
    cross: "⛔",
    diamond: "◇",
  },
} as const;

export function statusColor(status: string): number {
  switch (status) {
    case "LIVE":
      return KOS.colors.live;
    case "UPCOMING":
      return KOS.colors.upcoming;
    case "ENDED":
      return KOS.colors.ended;
    default:
      return KOS.colors.grey;
  }
}

export function statusBadge(status: string): string {
  switch (status) {
    case "LIVE":
      return `${KOS.emoji.live} LIVE`;
    case "UPCOMING":
      return `${KOS.emoji.upcoming} UPCOMING`;
    case "ENDED":
      return `${KOS.emoji.ended} ENDED`;
    case "CANCELLED":
      return "✖ CANCELLED";
    default:
      return status;
  }
}
