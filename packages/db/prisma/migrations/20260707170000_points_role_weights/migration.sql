-- Phase 3 S3/S4 foundation: points ledger + role-weighted raffle draws.

ALTER TABLE "raffles" ADD COLUMN "useRoleWeights" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "participants" ADD COLUMN "weight" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "role_weights" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "multiplier" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_weights_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "points_ledger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "points_ledger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "role_weights_organizationId_roleId_key" ON "role_weights"("organizationId", "roleId");
CREATE INDEX "role_weights_organizationId_guildId_idx" ON "role_weights"("organizationId", "guildId");

CREATE UNIQUE INDEX "points_ledger_organizationId_userId_sourceType_sourceId_key" ON "points_ledger"("organizationId", "userId", "sourceType", "sourceId");
CREATE INDEX "points_ledger_organizationId_userId_idx" ON "points_ledger"("organizationId", "userId");
CREATE INDEX "points_ledger_organizationId_createdAt_idx" ON "points_ledger"("organizationId", "createdAt");

ALTER TABLE "role_weights" ADD CONSTRAINT "role_weights_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
