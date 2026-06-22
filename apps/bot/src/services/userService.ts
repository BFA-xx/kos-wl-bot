import { prisma } from "@kos/db";

interface UserInput {
  id: string;
  username: string;
  globalName?: string | null;
  avatarUrl?: string | null;
}

/** Upsert a Discord user's global identity snapshot. */
export async function upsertUser(input: UserInput) {
  return prisma.user.upsert({
    where: { id: input.id },
    create: {
      id: input.id,
      username: input.username,
      globalName: input.globalName ?? null,
      avatarUrl: input.avatarUrl ?? null,
    },
    update: {
      username: input.username,
      globalName: input.globalName ?? undefined,
      avatarUrl: input.avatarUrl ?? undefined,
    },
  });
}

/** Ensure a guild row exists (called lazily when first interacting). */
export async function ensureGuild(input: {
  id: string;
  name?: string | null;
  iconUrl?: string | null;
}) {
  return prisma.guild.upsert({
    where: { id: input.id },
    create: {
      id: input.id,
      name: input.name ?? null,
      iconUrl: input.iconUrl ?? null,
    },
    update: {
      name: input.name ?? undefined,
      iconUrl: input.iconUrl ?? undefined,
    },
  });
}
