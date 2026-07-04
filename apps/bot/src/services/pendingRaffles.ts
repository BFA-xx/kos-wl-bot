import { randomBytes } from "node:crypto";
import { RoleMatchMode, WalletChain } from "@kos/db";
import type { EntryRequirements } from "../types.js";

/**
 * Short-lived draft bridging the `/raffle create` modal and the interactive
 * setup panel (channel/role selects + Publish). In-memory is fine for a single
 * bot process; drafts expire after 15 minutes.
 */
export interface PendingRaffle {
  guildId: string;
  createdById: string;
  createdByName: string;
  createdByAvatar: string | null;
  // From the modal:
  projectName: string;
  title: string;
  description: string | null;
  spots: number;
  startAt: Date;
  endAt: Date;
  // From the panel selects (filled in incrementally):
  postChannelId: string | null;
  announceChannelId: string | null;
  proofChannelId: string | null;
  roles: { roleId: string; roleName: string }[];
  roleMatchMode: RoleMatchMode;
  // Defaults applied at publish:
  walletChains: WalletChain[];
  collectWallets: boolean;
  hideEntries: boolean;
  requireWallet: boolean;
  startPing: string;
  requirements: EntryRequirements | null;
  bannerUrl: string | null;
  externalUrl: string | null;
  createdAt: number;
}

const store = new Map<string, PendingRaffle>();
const TTL_MS = 15 * 60_000;

export function stashPending(data: Omit<PendingRaffle, "createdAt">): string {
  const nonce = randomBytes(8).toString("hex");
  store.set(nonce, { ...data, createdAt: Date.now() });
  return nonce;
}

/** Peek at a draft (mutate the returned object to update it in place). */
export function getPending(nonce: string): PendingRaffle | undefined {
  return store.get(nonce);
}

/** Remove and return a draft (call on publish/cancel). */
export function takePending(nonce: string): PendingRaffle | undefined {
  const data = store.get(nonce);
  if (data) store.delete(nonce);
  return data;
}

const sweep = setInterval(() => {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of store) if (v.createdAt < cutoff) store.delete(k);
}, 60_000);
sweep.unref();

/**
 * Carry an uploaded banner image (from the /raffle create attachment option)
 * across to the modal submit. Keyed by user id since the two steps happen
 * back-to-back for the same person.
 */
const bannerStash = new Map<string, { url: string; ts: number }>();

export function stashBanner(userId: string, url: string): void {
  bannerStash.set(userId, { url, ts: Date.now() });
}

export function takeBanner(userId: string): string | null {
  const entry = bannerStash.get(userId);
  if (!entry) return null;
  bannerStash.delete(userId);
  return Date.now() - entry.ts > TTL_MS ? null : entry.url;
}
