-- Team Wallet Pool: organization-scoped ownership, globally unique wallet
-- fingerprints, selection configuration, and immutable raffle usage history.

CREATE TYPE "TeamWalletStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'DISABLED');
CREATE TYPE "TeamWalletUsageStatus" AS ENUM ('RESERVED', 'RELEASED');
CREATE TYPE "TeamWalletSelectionMode" AS ENUM ('ROUND_ROBIN', 'RANDOM', 'PRIORITY');

CREATE TABLE "team_wallet_pools" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Team Wallet Pool',
  "isDefault" BOOLEAN NOT NULL DEFAULT true,
  "selectionMode" "TeamWalletSelectionMode" NOT NULL DEFAULT 'ROUND_ROBIN',
  "lastSelectedOwnerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "team_wallet_pools_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "team_wallet_pool_members" (
  "id" TEXT NOT NULL,
  "poolId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "team_wallet_pool_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "team_wallets" (
  "id" TEXT NOT NULL,
  "poolId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "chain" "WalletChain" NOT NULL,
  "address" TEXT NOT NULL,
  "addressHash" TEXT NOT NULL,
  "status" "TeamWalletStatus" NOT NULL DEFAULT 'AVAILABLE',
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "timesUsed" INTEGER NOT NULL DEFAULT 0,
  "lastUsedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "team_wallets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "raffle_team_wallet_fills" (
  "id" TEXT NOT NULL,
  "poolId" TEXT NOT NULL,
  "raffleId" INTEGER NOT NULL,
  "selectionMode" "TeamWalletSelectionMode" NOT NULL,
  "requiredWallets" INTEGER NOT NULL,
  "communityWallets" INTEGER NOT NULL,
  "selectedWallets" INTEGER NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "raffle_team_wallet_fills_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "team_wallet_usages" (
  "id" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "raffleId" INTEGER NOT NULL,
  "fillId" TEXT NOT NULL,
  "projectName" TEXT NOT NULL,
  "status" "TeamWalletUsageStatus" NOT NULL DEFAULT 'RESERVED',
  "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "releasedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "team_wallet_usages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_wallet_pools_organizationId_name_key"
  ON "team_wallet_pools"("organizationId", "name");
CREATE INDEX "team_wallet_pools_organizationId_isDefault_idx"
  ON "team_wallet_pools"("organizationId", "isDefault");
CREATE UNIQUE INDEX "team_wallet_pool_members_poolId_userId_key"
  ON "team_wallet_pool_members"("poolId", "userId");
CREATE INDEX "team_wallet_pool_members_poolId_priority_idx"
  ON "team_wallet_pool_members"("poolId", "priority");
CREATE INDEX "team_wallet_pool_members_userId_idx"
  ON "team_wallet_pool_members"("userId");
CREATE UNIQUE INDEX "team_wallets_addressHash_key"
  ON "team_wallets"("addressHash");
CREATE INDEX "team_wallets_poolId_status_idx"
  ON "team_wallets"("poolId", "status");
CREATE INDEX "team_wallets_poolId_ownerId_status_idx"
  ON "team_wallets"("poolId", "ownerId", "status");
CREATE INDEX "team_wallets_ownerId_idx"
  ON "team_wallets"("ownerId");
CREATE INDEX "raffle_team_wallet_fills_raffleId_createdAt_idx"
  ON "raffle_team_wallet_fills"("raffleId", "createdAt");
CREATE INDEX "raffle_team_wallet_fills_poolId_createdAt_idx"
  ON "raffle_team_wallet_fills"("poolId", "createdAt");
CREATE UNIQUE INDEX "team_wallet_usages_walletId_raffleId_key"
  ON "team_wallet_usages"("walletId", "raffleId");
CREATE INDEX "team_wallet_usages_raffleId_status_idx"
  ON "team_wallet_usages"("raffleId", "status");
CREATE INDEX "team_wallet_usages_walletId_reservedAt_idx"
  ON "team_wallet_usages"("walletId", "reservedAt");

ALTER TABLE "team_wallet_pools"
  ADD CONSTRAINT "team_wallet_pools_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_wallet_pool_members"
  ADD CONSTRAINT "team_wallet_pool_members_poolId_fkey"
  FOREIGN KEY ("poolId") REFERENCES "team_wallet_pools"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_wallet_pool_members"
  ADD CONSTRAINT "team_wallet_pool_members_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_wallets"
  ADD CONSTRAINT "team_wallets_poolId_fkey"
  FOREIGN KEY ("poolId") REFERENCES "team_wallet_pools"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_wallets"
  ADD CONSTRAINT "team_wallets_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "raffle_team_wallet_fills"
  ADD CONSTRAINT "raffle_team_wallet_fills_poolId_fkey"
  FOREIGN KEY ("poolId") REFERENCES "team_wallet_pools"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "raffle_team_wallet_fills"
  ADD CONSTRAINT "raffle_team_wallet_fills_raffleId_fkey"
  FOREIGN KEY ("raffleId") REFERENCES "raffles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "raffle_team_wallet_fills"
  ADD CONSTRAINT "raffle_team_wallet_fills_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "team_wallet_usages"
  ADD CONSTRAINT "team_wallet_usages_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "team_wallets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_wallet_usages"
  ADD CONSTRAINT "team_wallet_usages_raffleId_fkey"
  FOREIGN KEY ("raffleId") REFERENCES "raffles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_wallet_usages"
  ADD CONSTRAINT "team_wallet_usages_fillId_fkey"
  FOREIGN KEY ("fillId") REFERENCES "raffle_team_wallet_fills"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_wallet_usages"
  ADD CONSTRAINT "team_wallet_usages_releasedById_fkey"
  FOREIGN KEY ("releasedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Fill is intentionally limited to organization owners, Admins, and Collab
-- Managers. Custom roles remain unchanged so access must be delegated on purpose.
UPDATE "organization_roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT permission
  FROM unnest("permissions" || ARRAY['team-wallet:fill']) AS permission
)
WHERE "isSystem" = true AND "name" IN ('Owner', 'Admin', 'Collab Manager');
