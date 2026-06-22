import { ActivityType, Events } from "discord.js";
import { prisma } from "@kos/db";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { createClient } from "./client.js";
import { handleInteraction } from "./interactions/router.js";
import { Scheduler } from "./services/scheduler.js";
import { ensureGuild } from "./services/userService.js";
import { entryLimiter } from "./interactions/buttons.js";
import { startInternalApi } from "./http/server.js";
import type { Server } from "node:http";

async function main() {
  const client = createClient();
  let scheduler: Scheduler | undefined;
  let internalApi: Server | undefined;

  client.once(Events.ClientReady, async (c) => {
    logger.info(
      { user: c.user.tag, guilds: c.guilds.cache.size },
      "KOS WL Bot is online",
    );
    c.user.setPresence({
      activities: [{ name: "WL Raffles", type: ActivityType.Watching }],
      status: "online",
    });

    // Register guilds we're already in (lazy config rows).
    for (const guild of c.guilds.cache.values()) {
      await ensureGuild({ id: guild.id, name: guild.name, iconUrl: guild.iconURL() }).catch(
        () => undefined,
      );
    }

    scheduler = new Scheduler(c);
    scheduler.start();

    internalApi = startInternalApi(c);
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(interaction);
  });

  client.on(Events.GuildCreate, (guild) => {
    void ensureGuild({ id: guild.id, name: guild.name, iconUrl: guild.iconURL() });
    logger.info({ guildId: guild.id, name: guild.name }, "joined guild");
  });

  client.on(Events.Error, (err) => logger.error({ err }, "discord client error"));
  client.on(Events.Warn, (msg) => logger.warn({ msg }, "discord warning"));

  // Periodically bound the rate-limiter memory.
  const limiterSweep = setInterval(() => entryLimiter.sweep(), 60_000);

  // Graceful shutdown.
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    clearInterval(limiterSweep);
    scheduler?.stop();
    internalApi?.close();
    await client.destroy();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) =>
    logger.error({ reason }, "unhandled rejection"),
  );

  await client.login(config.DISCORD_TOKEN);
}

main().catch((err) => {
  logger.fatal({ err }, "fatal error on startup");
  process.exit(1);
});
