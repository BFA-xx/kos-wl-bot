import PDFDocument from "pdfkit";

export interface ProofReportData {
  raffleId: number;
  projectName: string;
  title: string;
  startAt: Date;
  endAt: Date;
  drawnAt: Date | null;
  roleMatchMode: string;
  eligibleRoles: string[];
  entryCount?: number;
  spots: number;
  winners: { position: number; username: string; userId: string }[];
  messageLink: string | null;
  drawSeedHash: string | null;
  brandName: string;
  logoBuffer?: Buffer | null;
}

// KOS palette
const BG = "#0a0a0a";
const FG = "#ffffff";
const MUTED = "#8a8a8a";
const LINE = "#242424";
const SILVER = "#c0c0c0";

/**
 * Render a professional, black-themed PDF proof report and resolve to a Buffer.
 */
export function renderProofPdf(data: ProofReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width;
    const H = doc.page.height;
    const M = 48;

    // Full black background.
    doc.rect(0, 0, W, H).fill(BG);

    // Header band.
    let y = M;
    if (data.logoBuffer) {
      try {
        doc.image(data.logoBuffer, M, y, { fit: [40, 40] });
      } catch {
        /* ignore bad logo */
      }
    }
    doc
      .fillColor(FG)
      .font("Helvetica-Bold")
      .fontSize(22)
      .text(data.brandName, M + (data.logoBuffer ? 52 : 0), y + 4);
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(10)
      .text(
        "Whitelist Raffle — Verifiable Proof Report",
        M + (data.logoBuffer ? 52 : 0),
        y + 30,
      );

    y += 64;
    doc
      .moveTo(M, y)
      .lineTo(W - M, y)
      .lineWidth(1)
      .strokeColor(LINE)
      .stroke();
    y += 24;

    // Title block.
    doc
      .fillColor(SILVER)
      .font("Helvetica-Bold")
      .fontSize(16)
      .text(data.projectName, M, y);
    y += 22;
    doc.fillColor(FG).font("Helvetica").fontSize(13).text(data.title, M, y);
    y += 30;

    // Info grid.
    const rows: [string, string][] = [
      ["Raffle ID", `#${data.raffleId}`],
      ["WL Spots", String(data.spots)],
      ...(data.entryCount === undefined
        ? []
        : ([["Total Entries", String(data.entryCount)]] as [string, string][])),
      ["Total Winners", String(data.winners.length)],
      ["Start", data.startAt.toUTCString()],
      ["End", data.endAt.toUTCString()],
      ["Drawn", data.drawnAt ? data.drawnAt.toUTCString() : "—"],
      ["Role Mode", data.roleMatchMode],
      [
        "Eligible Roles",
        data.eligibleRoles.length ? data.eligibleRoles.join(", ") : "Everyone",
      ],
    ];

    doc.fontSize(10);
    for (const [label, value] of rows) {
      doc.fillColor(MUTED).font("Helvetica").text(label, M, y, { width: 140 });
      doc
        .fillColor(FG)
        .font("Helvetica-Bold")
        .text(value, M + 150, y, { width: W - M - M - 150 });
      y += 20;
    }

    y += 8;
    doc
      .moveTo(M, y)
      .lineTo(W - M, y)
      .lineWidth(1)
      .strokeColor(LINE)
      .stroke();
    y += 20;

    // Winners.
    doc
      .fillColor(SILVER)
      .font("Helvetica-Bold")
      .fontSize(13)
      .text("Winners", M, y);
    y += 22;
    doc.fontSize(10);
    if (data.winners.length === 0) {
      doc
        .fillColor(MUTED)
        .font("Helvetica")
        .text("No eligible entries — no winners drawn.", M, y);
      y += 18;
    } else {
      for (const w of data.winners) {
        if (y > H - 120) {
          doc.addPage();
          doc.rect(0, 0, W, H).fill(BG);
          y = M;
        }
        doc
          .fillColor(SILVER)
          .font("Helvetica-Bold")
          .text(`${w.position}.`, M, y, { width: 24 });
        doc
          .fillColor(FG)
          .font("Helvetica")
          .text(w.username, M + 28, y, { width: 200, continued: false });
        doc
          .fillColor(MUTED)
          .font("Helvetica")
          .fontSize(9)
          .text(w.userId, M + 240, y + 1);
        doc.fontSize(10);
        y += 18;
      }
    }

    // Verification footer.
    if (y > H - 140) {
      doc.addPage();
      doc.rect(0, 0, W, H).fill(BG);
      y = M;
    }
    y = Math.max(y + 16, H - 130);
    doc
      .moveTo(M, y)
      .lineTo(W - M, y)
      .lineWidth(1)
      .strokeColor(LINE)
      .stroke();
    y += 14;
    doc.fillColor(MUTED).font("Helvetica").fontSize(8);
    if (data.drawSeedHash) {
      doc.text(`Draw commitment (SHA-256): ${data.drawSeedHash}`, M, y, {
        width: W - M - M,
      });
      y += 14;
    }
    if (data.messageLink) {
      doc
        .fillColor(SILVER)
        .text(`Announcement: ${data.messageLink}`, M, y, { width: W - M - M });
      y += 14;
    }
    doc
      .fillColor(MUTED)
      .text(
        `Generated ${new Date().toUTCString()} · Powered by KOS`,
        M,
        H - 36,
        { width: W - M - M, align: "center" },
      );

    doc.end();
  });
}
