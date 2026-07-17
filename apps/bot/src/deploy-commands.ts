import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { commands } from "./commands/index.js";
import { resolveCommandRegistrationTarget } from "./commands/registration.js";
import { logger } from "./logger.js";

/**
 * Register slash commands with Discord.
 *
 * If DISCORD_GUILD_ID is set, commands register to that guild and appear
 * instantly (ideal for development). Otherwise they register globally
 * (can take up to an hour to propagate).
 */
async function deploy() {
  const body = commands.map((c) => c.data.toJSON());
  const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
  const target = resolveCommandRegistrationTarget(
    process.argv.slice(2),
    config.DISCORD_GUILD_ID,
  );

  if (target.scope === "guild") {
    await rest.put(
      Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, target.guildId),
      { body },
    );
    logger.info(
      { count: body.length, guildId: target.guildId },
      "registered guild commands (instant)",
    );
  } else {
    await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), {
      body,
    });
    if (target.compatibilityGuildId) {
      await rest.put(
        Routes.applicationGuildCommands(
          config.DISCORD_CLIENT_ID,
          target.compatibilityGuildId,
        ),
        { body },
      );
    }
    logger.info(
      {
        count: body.length,
        compatibilityGuildId: target.compatibilityGuildId,
      },
      "registered global commands (may take up to 1h)",
    );
  }
}

deploy().catch((err) => {
  logger.fatal({ err }, "failed to deploy commands");
  process.exit(1);
});
