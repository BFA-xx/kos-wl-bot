/**
 * Phase 2 data migration — move existing single-tenant KOS data into the new
 * Organization structure. Idempotent: safe to run multiple times.
 *
 * Creates one "KOS" organization owned by a super-admin, seeds the built-in
 * roles + a FREE subscription, and connects EVERY existing guild to it so no
 * existing raffle/participant/report is orphaned.
 *
 *   MIGRATION_OWNER_ID=<discordId> pnpm --filter @kos/db migrate:orgs
 *   # or the first id in SUPER_ADMIN_DISCORD_IDS is used automatically.
 *
 * Point DATABASE_URL at the TARGET database. Never run against prod until the
 * additive schema migration has been applied there.
 */
import { PrismaClient } from "@prisma/client";
// Pure, dependency-free permission definitions shared with the dashboard.
import { BUILTIN_ROLES, OWNER_ROLE } from "../../../apps/dashboard/lib/permissions";

const prisma = new PrismaClient();

const ORG_SLUG = "kos";
const ORG_NAME = "KOS";

function resolveOwnerId(): string {
  const fromEnv =
    process.env.MIGRATION_OWNER_ID ||
    (process.env.SUPER_ADMIN_DISCORD_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean)[0] ||
    process.argv[2];
  if (!fromEnv) {
    throw new Error(
      "No owner id. Set MIGRATION_OWNER_ID or SUPER_ADMIN_DISCORD_IDS, or pass it as an argument.",
    );
  }
  return fromEnv;
}

async function main() {
  const ownerId = resolveOwnerId();
  console.log(`→ migrating existing data into org "${ORG_NAME}" owned by ${ownerId}`);

  // 1. Ensure the owner user exists + is a super-admin.
  await prisma.user.upsert({
    where: { id: ownerId },
    create: { id: ownerId, username: `owner-${ownerId.slice(-4)}`, isSuperAdmin: true },
    update: { isSuperAdmin: true },
  });

  // 2. Create (or reuse) the KOS organization.
  const org = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    create: { slug: ORG_SLUG, name: ORG_NAME, ownerId },
    update: {},
  });
  console.log(`  org: ${org.id} (/${org.slug})`);

  // 3. Seed the built-in roles.
  for (const r of BUILTIN_ROLES) {
    await prisma.organizationRole.upsert({
      where: { organizationId_name: { organizationId: org.id, name: r.name } },
      create: { organizationId: org.id, name: r.name, permissions: r.permissions, isSystem: true },
      update: { permissions: r.permissions, isSystem: true },
    });
  }
  const ownerRole = await prisma.organizationRole.findFirstOrThrow({
    where: { organizationId: org.id, name: OWNER_ROLE },
  });
  console.log(`  roles: seeded ${BUILTIN_ROLES.length}`);

  // 4. Owner membership.
  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: ownerId } },
    create: { organizationId: org.id, userId: ownerId, roleId: ownerRole.id, status: "ACTIVE" },
    update: { roleId: ownerRole.id, status: "ACTIVE" },
  });

  // 5. FREE subscription.
  await prisma.subscription.upsert({
    where: { organizationId: org.id },
    create: { organizationId: org.id, plan: "FREE", status: "ACTIVE" },
    update: {},
  });

  // 6. Connect every existing guild so no raffle is orphaned.
  const guilds = await prisma.guild.findMany({ select: { id: true } });
  const hasPrimary = await prisma.guildConnection.count({
    where: { organizationId: org.id, isPrimary: true },
  });
  let created = 0;
  for (let i = 0; i < guilds.length; i++) {
    const existing = await prisma.guildConnection.findUnique({ where: { guildId: guilds[i]!.id } });
    if (existing) continue;
    await prisma.guildConnection.create({
      data: {
        organizationId: org.id,
        guildId: guilds[i]!.id,
        connectedById: ownerId,
        ownershipVerified: true,
        isPrimary: hasPrimary === 0 && created === 0,
      },
    });
    created++;
  }

  const orgGuildIds = (
    await prisma.guildConnection.findMany({
      where: { organizationId: org.id },
      select: { guildId: true },
    })
  ).map((g) => g.guildId);
  const [raffleCount, memberCount] = await Promise.all([
    prisma.raffle.count({ where: { guildId: { in: orgGuildIds } } }),
    prisma.organizationMember.count({ where: { organizationId: org.id } }),
  ]);
  const connCount = orgGuildIds.length;

  console.log("\n✅ migration complete");
  console.log(`   guilds connected: ${connCount} (${created} new)`);
  console.log(`   raffles now visible under /${org.slug}: ${raffleCount}`);
  console.log(`   members: ${memberCount}`);
}

main()
  .catch((err) => {
    console.error("migration failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
