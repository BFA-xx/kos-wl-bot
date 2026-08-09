import ExcelJS from "exceljs";

export interface AddressRow {
  username: string;
  address: string;
  chain?: string | null;
  source?: "Community" | "Team Pool";
  teamMember?: string | null;
}

/**
 * Build an .xlsx workbook of addresses, headed by "KOS X {project}".
 * `mode` controls which columns appear.
 */
export async function addressesWorkbook(
  project: string,
  rows: AddressRow[],
  mode: "addresses" | "full" = "addresses",
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "KOS Raffles";
  const ws = wb.addWorksheet("Addresses");
  const includeSource = rows.some((row) => Boolean(row.source));
  const includeTeamMember = rows.some((row) => Boolean(row.teamMember));

  const columnCount =
    (mode === "full" ? 3 : 1) +
    (includeSource ? 1 : 0) +
    (includeTeamMember ? 1 : 0);
  const lastCol = String.fromCharCode(64 + columnCount);
  ws.mergeCells(`A1:${lastCol}1`);
  const title = ws.getCell("A1");
  title.value = `KOS X ${project}`;
  title.font = { bold: true, size: 14, color: { argb: "FF000000" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  title.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFEDEDED" },
  };
  ws.getRow(1).height = 22;

  const header =
    mode === "full"
      ? [
          "Username",
          "Chain",
          "Wallet Address",
          ...(includeSource ? ["Source"] : []),
          ...(includeTeamMember ? ["Team Member"] : []),
        ]
      : [
          "Wallet Address",
          ...(includeSource ? ["Source"] : []),
          ...(includeTeamMember ? ["Team Member"] : []),
        ];
  const headerRow = ws.addRow(header);
  headerRow.font = { bold: true };

  for (const r of rows) {
    if (mode === "full")
      ws.addRow([
        r.username,
        r.chain ?? "",
        r.address,
        ...(includeSource ? [r.source ?? ""] : []),
        ...(includeTeamMember ? [r.teamMember ?? ""] : []),
      ]);
    else
      ws.addRow([
        r.address,
        ...(includeSource ? [r.source ?? ""] : []),
        ...(includeTeamMember ? [r.teamMember ?? ""] : []),
      ]);
  }

  // Column widths
  if (mode === "full") {
    ws.getColumn(1).width = 24;
    ws.getColumn(2).width = 12;
    ws.getColumn(3).width = 50;
    if (includeSource) ws.getColumn(4).width = 16;
    if (includeTeamMember)
      ws.getColumn(3 + (includeSource ? 1 : 0) + 1).width = 24;
  } else {
    ws.getColumn(1).width = 50;
    if (includeSource) ws.getColumn(2).width = 16;
    if (includeTeamMember)
      ws.getColumn(1 + (includeSource ? 1 : 0) + 1).width = 24;
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
