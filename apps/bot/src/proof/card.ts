import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";

export interface WinnerCardData {
  projectName: string;
  title: string;
  spots: number;
  entryCount: number;
  winners: { username: string }[];
  timestamp: Date;
  brandName: string;
  logoUrl?: string | null;
}

const W = 1200;
const H = 675;

// KOS palette
const BG = "#0a0a0a";
const PANEL = "#141414";
const FG = "#ffffff";
const SILVER = "#c0c0c0";
const MUTED = "#7d7d7d";
const LINE = "#2b2b2b";

/**
 * Render a premium black/white winner card PNG. Doubles as the proof
 * "screenshot" artifact. Returns a PNG Buffer.
 */
export async function renderWinnerCard(data: WinnerCardData): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background + subtle border frame.
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, W - 48, H - 48);

  // Top hairline accent.
  ctx.fillStyle = SILVER;
  ctx.fillRect(48, 92, W - 96, 1);

  // Header: brand + optional logo.
  let headerX = 48;
  if (data.logoUrl) {
    try {
      const img = await loadImage(data.logoUrl);
      const size = 40;
      ctx.drawImage(img, 48, 40, size, size);
      headerX = 100;
    } catch {
      /* ignore */
    }
  }
  ctx.fillStyle = FG;
  ctx.font = "bold 28px Arial";
  ctx.fillText(data.brandName, headerX, 70);

  ctx.fillStyle = MUTED;
  ctx.font = "16px Arial";
  ctx.textAlign = "right";
  ctx.fillText("WHITELIST RAFFLE", W - 48, 66);
  ctx.textAlign = "left";

  // Project + title.
  ctx.fillStyle = SILVER;
  ctx.font = "bold 22px Arial";
  ctx.fillText(data.projectName.toUpperCase(), 48, 150);

  ctx.fillStyle = FG;
  ctx.font = "bold 40px Arial";
  ctx.fillText(truncate(ctx, data.title, W - 96), 48, 196);

  // Stat panels.
  drawStat(ctx, 48, 230, "WL SPOTS", String(data.spots));
  drawStat(ctx, 248, 230, "ENTRIES", String(data.entryCount));
  drawStat(ctx, 448, 230, "WINNERS", String(data.winners.length));

  // Winners list.
  ctx.fillStyle = MUTED;
  ctx.font = "bold 15px Arial";
  ctx.fillText("WINNERS", 48, 360);
  ctx.fillStyle = LINE;
  ctx.fillRect(48, 372, W - 96, 1);

  const maxShown = 12;
  const shown = data.winners.slice(0, maxShown);
  const colX = [48, 416, 784];
  const rowH = 36;
  ctx.font = "20px Arial";
  shown.forEach((w, i) => {
    const col = Math.floor(i / 4);
    const row = i % 4;
    const x = colX[col]!;
    const y = 410 + row * rowH;
    ctx.fillStyle = SILVER;
    ctx.fillText(`${i + 1}.`, x, y);
    ctx.fillStyle = FG;
    ctx.fillText(truncate(ctx, w.username, 300), x + 34, y);
  });

  if (data.winners.length > maxShown) {
    ctx.fillStyle = MUTED;
    ctx.font = "16px Arial";
    ctx.fillText(`+ ${data.winners.length - maxShown} more`, 48, 410 + 4 * rowH);
  }

  // Footer.
  ctx.fillStyle = LINE;
  ctx.fillRect(48, H - 70, W - 96, 1);
  ctx.fillStyle = MUTED;
  ctx.font = "15px Arial";
  ctx.fillText("Powered by KOS", 48, H - 44);
  ctx.textAlign = "right";
  ctx.fillText(data.timestamp.toUTCString(), W - 48, H - 44);
  ctx.textAlign = "left";

  return canvas.toBuffer("image/png");
}

function drawStat(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  label: string,
  value: string,
): void {
  const w = 170;
  const h = 86;
  ctx.fillStyle = PANEL;
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = MUTED;
  ctx.font = "14px Arial";
  ctx.fillText(label, x + 16, y + 28);
  ctx.fillStyle = FG;
  ctx.font = "bold 36px Arial";
  ctx.fillText(value, x + 16, y + 68);
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
