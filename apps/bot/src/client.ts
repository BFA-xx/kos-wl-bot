import { Client, GatewayIntentBits, Partials } from "discord.js";

/**
 * Build the Discord client with the minimum intents the bot needs:
 *  - Guilds:               core guild/channel data.
 *  - GuildMembers:         role checks + server-join-age anti-alt (privileged).
 *  - GuildMessages:        raid proof messages and screenshot attachments.
 *  - MessageContent:       X/comment/quote URL detection (privileged).
 *  - GuildMessageReactions: required-reaction entry gating.
 *
 * GuildMembers and MessageContent are privileged intents — enable both in the
 * Developer Portal.
 */
export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.Channel],
    allowedMentions: { parse: ["users"] },
  });
}
