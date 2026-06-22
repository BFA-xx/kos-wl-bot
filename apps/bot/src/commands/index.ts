import type { Command } from "../types.js";
import { raffleCommand } from "./raffle.js";
import { blacklistCommand } from "./blacklist.js";
import { walletCommand } from "./wallet.js";
import { configCommand } from "./config.js";

export const commands: Command[] = [
  raffleCommand,
  blacklistCommand,
  walletCommand,
  configCommand,
];

/** Lookup map by command name for the interaction router. */
export const commandMap = new Map<string, Command>(
  commands.map((c) => [c.data.name, c]),
);
