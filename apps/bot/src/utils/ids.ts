/**
 * Custom-id codec for component interactions.
 *
 * Discord custom ids are limited to 100 chars. We use a simple
 * `namespace:action:arg1:arg2` scheme so the interaction router can dispatch
 * without storing component state server-side.
 */
const SEP = ":";
const NS = "kos";

export type ComponentId = {
  action: string;
  args: string[];
};

export function buildId(action: string, ...args: (string | number)[]): string {
  const id = [NS, action, ...args.map(String)].join(SEP);
  if (id.length > 100) {
    throw new Error(`custom id too long (${id.length}): ${id}`);
  }
  return id;
}

export function parseId(customId: string): ComponentId | null {
  const parts = customId.split(SEP);
  if (parts[0] !== NS || parts.length < 2) return null;
  return { action: parts[1]!, args: parts.slice(2) };
}

// Known component actions.
export const Actions = {
  EnterRaffle: "enter",
  LeaveRaffle: "leave",
  // Raffle creation modal + setup wizard panel
  SubmitRaffleCreate: "raffle_create",
  RaffleSetPost: "rf_post",
  RaffleSetAnnounce: "rf_ann",
  RaffleSetProof: "rf_proof",
  RaffleSetRoles: "rf_roles",
  RaffleToggleMatch: "rf_match",
  RaffleMoreOptions: "rf_more",
  SubmitRaffleOptions: "rf_opts",
  RafflePublish: "rf_pub",
  RaffleCancel: "rf_cancel",
  // Per-raffle winner wallet (DM form)
  OpenWalletForm: "wallet_open",
  SubmitWallet: "wallet_submit",
  // Self-serve wallet registry panel
  OpenWalletProfile: "wp_open",
  SubmitWalletProfile: "wp_submit",
} as const;
