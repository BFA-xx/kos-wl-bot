import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { addressesWorkbook } from "./xlsx";

describe("raffle wallet workbook sources", () => {
  it("adds Source and preserves community/team distinctions", async () => {
    const output = await addressesWorkbook(
      "KOS Project",
      [
        {
          username: "community-user",
          chain: "ETHEREUM",
          address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          source: "Community",
        },
        {
          username: "team-user",
          chain: "ETHEREUM",
          address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          source: "Team Pool",
        },
      ],
      "full",
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      output as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const sheet = workbook.getWorksheet("Addresses")!;
    expect(sheet.getRow(2).values).toEqual([
      undefined,
      "Username",
      "Chain",
      "Wallet Address",
      "Source",
    ]);
    expect(sheet.getCell("D3").value).toBe("Community");
    expect(sheet.getCell("D4").value).toBe("Team Pool");
  });

  it("does not alter collaboration workbooks without source values", async () => {
    const output = await addressesWorkbook(
      "Collab",
      [
        {
          username: "member",
          chain: "SOLANA",
          address: "11111111111111111111111111111111",
        },
      ],
      "full",
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      output as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    expect(workbook.getWorksheet("Addresses")!.getRow(2).cellCount).toBe(3);
  });
});
