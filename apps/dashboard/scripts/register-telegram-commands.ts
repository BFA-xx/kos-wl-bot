import { callTelegramApi } from "@kos/db";

const token =
  process.env.TELEGRAM_BOT_TOKEN?.trim() || process.env.BOT_TOKEN?.trim();
if (!token) throw new Error("TELEGRAM_BOT_TOKEN or BOT_TOKEN is required");

const privateCommands = [
  { command: "start", description: "Start or continue KOS onboarding" },
  { command: "menu", description: "Open the KOS menu" },
  { command: "profile", description: "View your KOS profile" },
  { command: "status", description: "Check community access approval" },
  { command: "raffles", description: "Browse active KOS raffles" },
  { command: "entries", description: "View your raffle entries" },
  { command: "points", description: "View KOS points and level" },
  { command: "leaderboard", description: "View the KOS leaderboard" },
  { command: "invite", description: "Create your KOS referral link" },
  { command: "notifications", description: "Manage notification preferences" },
  { command: "admin", description: "Open KOS admin links" },
];

const groupAdminCommands = [
  { command: "approvals", description: "Review KOS access requests" },
  { command: "quickraffle", description: "Create a quick KOS raffle" },
  { command: "raffle", description: "Publish an existing KOS raffle" },
  { command: "stats", description: "View KOS community stats" },
  { command: "announce", description: "Post a KOS announcement" },
  { command: "givepoints", description: "Award points to a replied member" },
  { command: "user", description: "Inspect a replied member" },
  { command: "warn", description: "Warn a replied member" },
  { command: "mute", description: "Temporarily mute a replied member" },
  { command: "ban", description: "Ban a replied member" },
  { command: "unban", description: "Unban by Telegram user ID" },
  { command: "settings", description: "Open KOS community settings" },
  { command: "chatid", description: "Show this Telegram chat ID" },
  { command: "cancel", description: "Cancel your quick-raffle setup" },
];

async function setCommands(
  commands: Array<{ command: string; description: string }>,
  scope: Record<string, string>,
): Promise<void> {
  const result = await callTelegramApi(token!, "setMyCommands", {
    commands,
    scope,
  });
  if (!result.ok) throw new Error(result.description ?? "setMyCommands failed");
}

async function main(): Promise<void> {
  await setCommands(privateCommands, { type: "all_private_chats" });
  await setCommands(groupAdminCommands, { type: "all_chat_administrators" });
  console.log(
    `Registered ${privateCommands.length} private and ${groupAdminCommands.length} group-admin KOS Bot commands.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Command registration failed");
  process.exitCode = 1;
});
