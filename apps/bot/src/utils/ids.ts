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
  RaffleSetChains: "rf_chains",
  RaffleToggleMatch: "rf_match",
  RaffleToggleHide: "rf_hide",
  RaffleToggleWallet: "rf_wallet",
  RaffleCyclePing: "rf_ping",
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
  // Member-side task verification from raffle prompts.
  VerifyRaffleTask: "task_v",
  VerifyLegacyTask: "legacy_v",
  // KOS Discord verification member flow.
  VerificationStart: "v_start",
  VerificationAgreeRules: "v_agree",
  VerificationAdminPanel: "v_admin",
  VerificationAdminChannels: "v_channels",
  VerificationAdminRoles: "v_roles",
  VerificationToggle: "v_toggle",
  VerificationEditWelcome: "v_welcome",
  VerificationEditModal: "v_modal",
  VerificationEditMessages: "v_messages",
  VerificationPublish: "v_publish",
  VerificationSyncAccess: "v_sync",
  VerificationClearSetting: "v_clear",
  VerificationSetVerifyChannel: "v_set_verify",
  VerificationSetRulesChannel: "v_set_rules",
  VerificationSetLogChannel: "v_set_log",
  VerificationSetAllowedChannels: "v_set_allowed",
  VerificationSetUnverifiedRole: "v_set_unverified",
  VerificationSetDefaultRoles: "v_set_defaults",
  VerificationSubmitCode: "v_submit",
  VerificationSaveWelcome: "v_save_welcome",
  VerificationSaveModal: "v_save_modal",
  VerificationSaveMessages: "v_save_messages",
  VerificationCodeCreate: "vc_create",
  VerificationCodeEdit: "vc_edit",
  VerificationCodeRoles: "vc_roles",
  VerificationCodeDelete: "vc_delete",
  VerificationCodeCancel: "vc_cancel",
  // Team Wallet Pool fill panel (/raffle fill).
  TeamWalletInc: "twf_inc",
  TeamWalletDec: "twf_dec",
  TeamWalletMax: "twf_max",
  TeamWalletMode: "twf_mode",
  TeamWalletConfirm: "twf_ok",
  TeamWalletCancel: "twf_x",
  TeamWalletSetOpen: "twf_set",
  TeamWalletSetSubmit: "twf_setn",
} as const;
