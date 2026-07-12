import {
  createCanvas,
  loadImage,
  GlobalFonts,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Bundle a font so text renders on headless servers (napi-canvas has no
// system fonts on a minimal EC2 box — without this the card comes out blank).
const FONT = "KOS Sans";
const FONT_BOLD = "KOS Sans Bold";
try {
  const dir = fileURLToPath(new URL("../../assets/fonts/", import.meta.url));
  GlobalFonts.registerFromPath(path.join(dir, "Inter-Regular.ttf"), FONT);
  GlobalFonts.registerFromPath(path.join(dir, "Inter-Bold.ttf"), FONT_BOLD);
} catch {
  /* fall back to whatever the system provides */
}

export interface WinnerCardData {
  projectName: string;
  title: string;
  spots: number;
  entryCount?: number;
  winners: { username: string }[];
  timestamp: Date;
  brandName: string;
  logoUrl?: string | null;
  raffleId?: number;
  commitment?: string | null;
}

const W = 1200;
const H = 675;

// Palette matched to the redesigned dashboard (dark KOS).
const BG = "#0a0a0a";
const CARD = "#121212";
const FG = "#ffffff";
const SILVER = "#c0c0c0";
const MUTED = "#8a8a8a";
const LINE = "#242424";
const BORDER = "#2a2a2a";

const reg = (size: number) => `${size}px ${FONT}`;
const bold = (size: number) => `${size}px ${FONT_BOLD}`;

/** Render a premium dark KOS winner card PNG. Returns a PNG Buffer. */
export async function renderWinnerCard(data: WinnerCardData): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background + soft top glow (matches the dashboard's radial highlight).
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.78, -80, 40, W * 0.78, -80, 640);
  glow.addColorStop(0, "rgba(255,255,255,0.06)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Outer rounded frame.
  roundRect(ctx, 20, 20, W - 40, H - 40, 24);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const PAD = 56;

  // ── Header ──
  let brandX = PAD;
  if (data.logoUrl) {
    try {
      const img = await loadImage(data.logoUrl);
      ctx.save();
      roundRect(ctx, PAD, 44, 40, 40, 10);
      ctx.clip();
      ctx.drawImage(img, PAD, 44, 40, 40);
      ctx.restore();
      brandX = PAD + 52;
    } catch {
      /* ignore bad logo */
    }
  }
  ctx.fillStyle = FG;
  ctx.font = bold(30);
  ctx.fillText(data.brandName, brandX, 74);

  ctx.fillStyle = MUTED;
  ctx.font = reg(15);
  ctx.textAlign = "right";
  ctx.fillText(
    `VERIFIABLE PROOF${data.raffleId ? `  ·  RAFFLE #${data.raffleId}` : ""}`,
    W - PAD,
    70,
  );
  ctx.textAlign = "left";

  hairline(ctx, PAD, 104, W - PAD);

  // ── Project + title ──
  ctx.fillStyle = SILVER;
  ctx.font = reg(15);
  ctx.fillText("WHITELIST RAFFLE", PAD, 150);

  ctx.fillStyle = FG;
  ctx.font = bold(46);
  ctx.fillText(
    truncate(ctx, data.projectName.toUpperCase(), W - PAD * 2),
    PAD,
    200,
  );

  ctx.fillStyle = MUTED;
  ctx.font = reg(22);
  ctx.fillText(truncate(ctx, data.title, W - PAD * 2), PAD, 236);

  // ── Stat chips (like the dashboard stat cards) ──
  const chipY = 268;
  const stats: [string, string][] = [["WL SPOTS", String(data.spots)]];
  if (data.entryCount !== undefined) {
    stats.push(["ENTRIES", String(data.entryCount)]);
  }
  stats.push(["WINNERS", String(data.winners.length)]);
  stats.forEach(([label, value], index) => {
    chip(ctx, PAD + index * 216, chipY, label, value);
  });

  // ── Winners ──
  const listTop = 386;
  ctx.fillStyle = MUTED;
  ctx.font = bold(14);
  ctx.fillText("WINNERS", PAD, listTop);
  hairline(ctx, PAD, listTop + 14, W - PAD);

  const maxShown = 12;
  const shown = data.winners.slice(0, maxShown);
  const colX = [PAD, PAD + 384, PAD + 768];
  const rowH = 38;
  ctx.font = reg(20);
  if (shown.length === 0) {
    ctx.fillStyle = MUTED;
    ctx.fillText("No eligible entries — no winners drawn.", PAD, listTop + 54);
  }
  shown.forEach((w, i) => {
    const col = Math.floor(i / 4);
    const row = i % 4;
    const x = colX[col] ?? PAD;
    const y = listTop + 54 + row * rowH;
    ctx.fillStyle = SILVER;
    ctx.font = bold(18);
    ctx.fillText(`${i + 1}`, x, y);
    ctx.fillStyle = FG;
    ctx.font = reg(20);
    ctx.fillText(truncate(ctx, w.username, 300), x + 30, y);
  });
  if (data.winners.length > maxShown) {
    ctx.fillStyle = MUTED;
    ctx.font = reg(16);
    ctx.fillText(
      `+ ${data.winners.length - maxShown} more`,
      PAD,
      listTop + 54 + 4 * rowH,
    );
  }

  // ── Commitment ──
  if (data.commitment) {
    ctx.fillStyle = MUTED;
    ctx.font = reg(13);
    ctx.fillText(
      `Draw commitment (SHA-256): ${data.commitment.slice(0, 40)}…`,
      PAD,
      H - 100,
    );
  }

  // ── Footer ──
  hairline(ctx, PAD, H - 72, W - PAD);
  ctx.fillStyle = MUTED;
  ctx.font = reg(15);
  ctx.fillText("Powered by KOS", PAD, H - 44);
  ctx.textAlign = "right";
  ctx.fillText(data.timestamp.toUTCString(), W - PAD, H - 44);
  ctx.textAlign = "left";

  return canvas.toBuffer("image/png");
}

function chip(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  label: string,
  value: string,
): void {
  const w = 200;
  const h = 96;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = CARD;
  ctx.fill();
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = MUTED;
  ctx.font = `13px ${FONT}`;
  ctx.fillText(label, x + 18, y + 30);
  ctx.fillStyle = FG;
  ctx.font = `40px ${FONT_BOLD}`;
  ctx.fillText(value, x + 18, y + 76);
}

function hairline(ctx: SKRSContext2D, x1: number, y: number, x2: number): void {
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y + 0.5);
  ctx.lineTo(x2, y + 0.5);
  ctx.stroke();
}

function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncate(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
}
