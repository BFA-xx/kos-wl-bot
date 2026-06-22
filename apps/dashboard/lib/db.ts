// Prisma client for the dashboard. Imports @prisma/client directly (generated
// from the shared schema during build) so the dashboard can deploy on Vercel
// without building the @kos/db workspace package.
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ log: ["warn", "error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type { Prisma } from "@prisma/client";
