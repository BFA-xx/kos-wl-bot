import { PrismaClient } from "@prisma/client";

/**
 * Shared Prisma client singleton.
 *
 * In long-running processes (the bot) this is created once. In Next.js dev,
 * the module can be re-evaluated on hot reload, so we cache the instance on
 * `globalThis` to avoid exhausting the connection pool.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.PRISMA_LOG === "query"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;

// Re-export the generated types and enums so consumers depend only on @kos/db.
export * from "@prisma/client";
export { Prisma } from "@prisma/client";
