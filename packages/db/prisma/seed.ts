import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Optional seed. Set SEED_GUILD_ID in the environment to register a guild's
 * default configuration without going through Discord first. Safe to run
 * multiple times (idempotent upsert).
 */
async function main() {
  const guildId = process.env.SEED_GUILD_ID;
  if (!guildId) {
    console.log("[seed] SEED_GUILD_ID not set — nothing to seed.");
    return;
  }

  const guild = await prisma.guild.upsert({
    where: { id: guildId },
    create: {
      id: guildId,
      name: process.env.SEED_GUILD_NAME ?? "KOS Community",
      managerRoleIds: (process.env.SEED_MANAGER_ROLE_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      defaultAnnounceChannelId: process.env.SEED_ANNOUNCE_CHANNEL_ID ?? null,
      defaultProofChannelId: process.env.SEED_PROOF_CHANNEL_ID ?? null,
    },
    update: {},
  });

  console.log(`[seed] Guild ready: ${guild.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
