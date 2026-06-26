import ExcelJS from "exceljs";

export interface AddressRow {
  username: string;
  address: string;
  chain?: string | null;
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
  wb.creator = "KOS WL Bot";
  const ws = wb.addWorksheet("Addresses");

  const lastCol = mode === "full" ? "C" : "A";
  ws.mergeCells(`A1:${lastCol}1`);
  const title = ws.getCell("A1");
  title.value = `KOS X ${project}`;
  title.font = { bold: true, size: 14, color: { argb: "FF000000" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } };
  ws.getRow(1).height = 22;

  const header = mode === "full" ? ["Username", "Chain", "Wallet Address"] : ["Wallet Address"];
  const headerRow = ws.addRow(header);
  headerRow.font = { bold: true };

  for (const r of rows) {
    if (mode === "full") ws.addRow([r.username, r.chain ?? "", r.address]);
    else ws.addRow([r.address]);
  }

  // Column widths
  if (mode === "full") {
    ws.getColumn(1).width = 24;
    ws.getColumn(2).width = 12;
    ws.getColumn(3).width = 50;
  } else {
    ws.getColumn(1).width = 50;
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
