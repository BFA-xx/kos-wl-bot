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
  globalThis.kosClient = client;
  let scheduler: Scheduler | undefined;
  let internalApi: Server | undefined;

  client.once(Events.ClientReady, async (c) => {
    logger.info(
      { user: c.user.tag, guilds: c.guilds.cache.size },
      "KOS Raffles is online",
    );
    c.user.setPresence({
      activities: [{ name: "WL Raffles", type: ActivityType.Watching }],
      status: "online",
    });

    scheduler = new Scheduler(c);
    scheduler.start();

    internalApi = startInternalApi(c, () => scheduler?.health() ?? null);

    // Do not hold readiness behind one slow database write per guild. The
    // bounded sync keeps guild metadata current while the scheduler and health
    // endpoint are already serving.
    void syncConnectedGuilds(c.guilds.cache.values());
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(interaction);
  });

  client.on(Events.GuildCreate, (guild) => {
    logger.info({ guildId: guild.id, name: guild.name }, "joined guild");
    void syncGuild(guild);
  });

  client.on(Events.GuildUpdate, (_previous, guild) => {
    void syncGuild(guild);
  });

  client.on(Events.Error, (err) =>
    logger.error({ err }, "discord client error"),
  );
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

async function syncConnectedGuilds(
  guilds: Iterable<{ id: string; name: string; iconURL(): string | null }>,
): Promise<void> {
  const pending = [...guilds];
  const chunkSize = 10;
  for (let offset = 0; offset < pending.length; offset += chunkSize) {
    await Promise.all(pending.slice(offset, offset + chunkSize).map(syncGuild));
  }
  logger.info({ guilds: pending.length }, "guild metadata sync completed");
}

async function syncGuild(guild: {
  id: string;
  name: string;
  iconURL(): string | null;
}): Promise<void> {
  await ensureGuild({
    id: guild.id,
    name: guild.name,
    iconUrl: guild.iconURL(),
  }).catch((err) =>
    logger.warn({ err, guildId: guild.id }, "guild metadata sync failed"),
  );
}

main().catch((err) => {
  logger.fatal({ err }, "fatal error on startup");
  process.exit(1);
});
