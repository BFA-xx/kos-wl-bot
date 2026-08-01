import { createHash } from "node:crypto";
import type { WalletChain } from "@prisma/client";
import { isWalletChain, validateWalletAddress } from "@/lib/wallet-validation";

export type TeamWalletSelectionMode = "ROUND_ROBIN" | "RANDOM" | "PRIORITY";

export interface TeamWalletCandidate {
  id: string;
  ownerId: string;
  addressHash: string;
  timesUsed: number;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface TeamWalletMemberOrder {
  userId: string;
  priority: number;
}

export interface TeamWalletImportRow {
  row: number;
  chain: WalletChain;
  chains: WalletChain[];
  address: string;
  addressHash: string;
}

export interface TeamWalletImportError {
  row: number;
  error: string;
}

export function teamWalletAddressHash(
  chain: WalletChain,
  rawAddress: string,
): string {
  const validation = validateWalletAddress(chain, rawAddress);
  if (!validation.ok) throw new Error(validation.error);
  const normalized =
    chain === "BITCOIN" && validation.normalized.toLowerCase().startsWith("bc1")
      ? validation.normalized.toLowerCase()
      : validation.normalized;
  return createHash("sha256").update(normalized).digest("hex");
}

export function teamWalletChains(wallet: {
  chain: WalletChain;
  chains?: readonly WalletChain[];
}): WalletChain[] {
  return wallet.chains?.length
    ? [...new Set(wallet.chains)]
    : [wallet.chain];
}

function csvCells(line: string, delimiter: string): string[] {
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

export function parseTeamWalletImport(
  content: string,
  selectedChains: WalletChain | readonly WalletChain[],
  maxRows = 5_000,
): { rows: TeamWalletImportRow[]; errors: TeamWalletImportError[] } {
  const defaultChains =
    typeof selectedChains === "string" ? [selectedChains] : selectedChains;
  const lines = content
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .filter((line) => line.trim());
  if (!lines.length) return { rows: [], errors: [] };

  const delimiter = lines[0]!.includes("\t") ? "\t" : ",";
  const first = csvCells(lines[0]!, delimiter).map((value) =>
    value.toLowerCase().replace(/[\s-]+/gu, "_"),
  );
  const addressHeader = headerIndex(first, [
    "wallet_address",
    "wallet",
    "address",
  ]);
  const chainHeader = headerIndex(first, ["chain", "network"]);
  const hasHeader = addressHeader >= 0;
  const start = hasHeader ? 1 : 0;
  const rows: TeamWalletImportRow[] = [];
  const errors: TeamWalletImportError[] = [];
  const seen = new Map<string, TeamWalletImportRow>();
  let attempted = 0;

  const accept = (
    rawAddress: string,
    rawChains: unknown | readonly unknown[],
    row: number,
  ) => {
    attempted += 1;
    if (attempted > maxRows) return;
    const requested = Array.isArray(rawChains) ? rawChains : [rawChains];
    const chains: WalletChain[] = [];
    for (const value of requested) {
      const chain = String(value ?? "")
        .trim()
        .toUpperCase();
      if (!isWalletChain(chain)) {
        errors.push({ row, error: "Wallet chain is invalid." });
        return;
      }
      if (!chains.includes(chain)) chains.push(chain);
    }
    if (!chains.length) {
      errors.push({ row, error: "Select at least one wallet chain." });
      return;
    }

    const validations = chains.map((chain) => ({
      chain,
      validation: validateWalletAddress(chain, rawAddress),
    }));
    const invalid = validations.find((item) => !item.validation.ok);
    if (invalid && !invalid.validation.ok) {
      errors.push({
        row,
        error: `${invalid.chain}: ${invalid.validation.error}`,
      });
      return;
    }
    const address = validations[0]!.validation;
    if (!address.ok) return;
    const addressHash = teamWalletAddressHash(chains[0]!, address.normalized);
    const duplicate = seen.get(addressHash);
    if (duplicate) {
      const additions = chains.filter(
        (chain) => !duplicate.chains.includes(chain),
      );
      if (additions.length) {
        duplicate.chains.push(...additions);
        return;
      }
      errors.push({ row, error: "Duplicate address in this import." });
      return;
    }
    const parsed = {
      row,
      chain: chains[0]!,
      chains,
      address: address.normalized,
      addressHash,
    };
    seen.set(addressHash, parsed);
    rows.push(parsed);
  };

  for (
    let index = start;
    index < lines.length && attempted <= maxRows;
    index += 1
  ) {
    const row = index + 1;
    const values = csvCells(lines[index]!, delimiter).filter(Boolean);
    if (hasHeader) {
      accept(
        values[addressHeader] ?? "",
        chainHeader >= 0 ? values[chainHeader] : defaultChains,
        row,
      );
      continue;
    }
    if (values.length === 2 && isWalletChain(values[0]?.toUpperCase())) {
      accept(values[1] ?? "", values[0], row);
      continue;
    }
    if (values.length === 2 && isWalletChain(values[1]?.toUpperCase())) {
      accept(values[0] ?? "", values[1], row);
      continue;
    }
    const pasted =
      values.length > 1 ? values : lines[index]!.trim().split(/\s+/u);
    for (const address of pasted) accept(address, defaultChains, row);
  }

  if (attempted > maxRows) {
    errors.push({
      row: maxRows + 1,
      error: `Imports are limited to ${maxRows} wallets at a time.`,
    });
  }
  return { rows, errors };
}

function candidateOrder(
  a: TeamWalletCandidate,
  b: TeamWalletCandidate,
): number {
  if (a.timesUsed !== b.timesUsed) return a.timesUsed - b.timesUsed;
  const aLast = a.lastUsedAt?.getTime() ?? 0;
  const bLast = b.lastUsedAt?.getTime() ?? 0;
  if (aLast !== bLast) return aLast - bLast;
  const created = a.createdAt.getTime() - b.createdAt.getTime();
  return created || a.id.localeCompare(b.id);
}

function orderedOwnerIds(
  candidates: TeamWalletCandidate[],
  members: TeamWalletMemberOrder[],
): string[] {
  const priority = new Map(
    members.map((member) => [member.userId, member.priority]),
  );
  return [...new Set(candidates.map((wallet) => wallet.ownerId))].sort(
    (a, b) => {
      const priorityDifference =
        (priority.get(a) ?? Number.MAX_SAFE_INTEGER) -
        (priority.get(b) ?? Number.MAX_SAFE_INTEGER);
      return priorityDifference || a.localeCompare(b);
    },
  );
}

function shuffle<T>(values: T[], random: () => number): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!];
  }
  return shuffled;
}

export function selectTeamWallets({
  candidates,
  members,
  needed,
  mode,
  lastSelectedOwnerId,
  random = Math.random,
}: {
  candidates: TeamWalletCandidate[];
  members: TeamWalletMemberOrder[];
  needed: number;
  mode: TeamWalletSelectionMode;
  lastSelectedOwnerId?: string | null;
  random?: () => number;
}): { selected: TeamWalletCandidate[]; lastSelectedOwnerId: string | null } {
  if (needed <= 0 || candidates.length === 0) {
    return { selected: [], lastSelectedOwnerId: lastSelectedOwnerId ?? null };
  }
  const unique = [
    ...new Map(candidates.map((wallet) => [wallet.id, wallet])).values(),
  ];

  if (mode === "RANDOM") {
    const selected = shuffle(unique, random).slice(0, needed);
    return {
      selected,
      lastSelectedOwnerId:
        selected.at(-1)?.ownerId ?? lastSelectedOwnerId ?? null,
    };
  }

  let ownerIds = orderedOwnerIds(unique, members);
  const queues = new Map(
    ownerIds.map((ownerId) => [
      ownerId,
      unique
        .filter((wallet) => wallet.ownerId === ownerId)
        .sort(candidateOrder),
    ]),
  );

  if (mode === "PRIORITY") {
    const selected = ownerIds
      .flatMap((ownerId) => queues.get(ownerId) ?? [])
      .slice(0, needed);
    return {
      selected,
      lastSelectedOwnerId:
        selected.at(-1)?.ownerId ?? lastSelectedOwnerId ?? null,
    };
  }

  const lastIndex = lastSelectedOwnerId
    ? ownerIds.indexOf(lastSelectedOwnerId)
    : -1;
  if (lastIndex >= 0) {
    ownerIds = [
      ...ownerIds.slice(lastIndex + 1),
      ...ownerIds.slice(0, lastIndex + 1),
    ];
  }
  const selected: TeamWalletCandidate[] = [];
  while (selected.length < needed) {
    let progressed = false;
    for (const ownerId of ownerIds) {
      const wallet = queues.get(ownerId)?.shift();
      if (!wallet) continue;
      selected.push(wallet);
      progressed = true;
      if (selected.length === needed) break;
    }
    if (!progressed) break;
  }
  return {
    selected,
    lastSelectedOwnerId:
      selected.at(-1)?.ownerId ?? lastSelectedOwnerId ?? null,
  };
}
