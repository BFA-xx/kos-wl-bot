import { Client, GatewayIntentBits, Partials } from "discord.js";

/**
 * Build the Discord client with the minimum intents the bot needs:
 *  - Guilds:               core guild/channel data.
 *  - GuildMembers:         role checks + server-join-age anti-alt (privileged).
 *  - GuildMessageReactions: required-reaction entry gating.
 *
 * GuildMembers is a privileged intent — enable it in the Developer Portal.
 */
export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.Channel],
    allowedMentions: { parse: ["users"] },
  });
}
