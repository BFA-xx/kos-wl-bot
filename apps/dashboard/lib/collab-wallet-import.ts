import type { WalletChain } from "@prisma/client";
import { isWalletChain, validateWalletAddress } from "@/lib/wallet-validation";

export interface WalletImportRow {
  row: number;
  userId: string;
  chain: WalletChain;
  address: string;
}

export interface WalletImportError {
  row: number;
  error: string;
}

function cells(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      result.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  result.push(value.trim());
  return result;
}

function headerIndex(headers: string[], candidates: string[]): number {
  return headers.findIndex((value) => candidates.includes(value));
}

export function parseWalletImport(
  content: string,
  defaultChain: WalletChain,
  maxRows = 2_000,
): { rows: WalletImportRow[]; errors: WalletImportError[] } {
  const lines = content
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .filter((line) => line.trim());
  if (!lines.length) return { rows: [], errors: [] };
  const delimiter = lines[0]!.includes("\t") ? "\t" : ",";
  const first = cells(lines[0]!, delimiter).map((value) =>
    value.toLowerCase().replace(/[\s-]+/g, "_"),
  );
  const userHeader = headerIndex(first, [
    "discord_id",
    "discordid",
    "user_id",
    "userid",
    "user",
  ]);
  const addressHeader = headerIndex(first, [
    "wallet_address",
    "wallet",
    "address",
  ]);
  const chainHeader = headerIndex(first, ["chain", "network"]);
  const hasHeader = userHeader >= 0 && addressHeader >= 0;
  const start = hasHeader ? 1 : 0;
  const rows: WalletImportRow[] = [];
  const errors: WalletImportError[] = [];
  const seen = new Map<string, string>();

  for (
    let index = start;
    index < lines.length && rows.length < maxRows;
    index += 1
  ) {
    const rowNumber = index + 1;
    const values = cells(lines[index]!, delimiter);
    const userId = (values[hasHeader ? userHeader : 0] ?? "")
      .replace(/[<@!>]/g, "")
      .trim();
    const address = values[hasHeader ? addressHeader : values.length - 1] ?? "";
    const rawChain =
      hasHeader && chainHeader >= 0
        ? values[chainHeader]?.toUpperCase()
        : values.length >= 3
          ? values[1]?.toUpperCase()
          : defaultChain;
    if (!/^\d{5,25}$/u.test(userId)) {
      errors.push({ row: rowNumber, error: "Discord user ID is invalid." });
      continue;
    }
    if (!isWalletChain(rawChain)) {
      errors.push({ row: rowNumber, error: "Wallet chain is invalid." });
      continue;
    }
    const validation = validateWalletAddress(rawChain, address);
    if (!validation.ok) {
      errors.push({ row: rowNumber, error: validation.error });
      continue;
    }
    const key = `${userId}:${rawChain}`;
    const previous = seen.get(key);
    if (previous && previous !== validation.normalized) {
      errors.push({
        row: rowNumber,
        error:
          "This user and chain appear more than once with different addresses.",
      });
      continue;
    }
    if (previous) continue;
    seen.set(key, validation.normalized);
    rows.push({
      row: rowNumber,
      userId,
      chain: rawChain,
      address: validation.normalized,
    });
  }
  if (lines.length - start > maxRows) {
    errors.push({
      row: maxRows + start + 1,
      error: `Imports are limited to ${maxRows} rows.`,
    });
  }
  return { rows, errors };
}
