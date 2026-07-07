-- Points channel + first rewards store launch. Additive only.

ALTER TABLE "guilds" ADD COLUMN "defaultPointsChannelId" TEXT;

CREATE TYPE "RewardRedemptionStatus" AS ENUM ('PENDING','FULFILLED','CANCELLED','REJECTED');

CREATE TABLE "rewards" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "cost" INTEGER NOT NULL,
    "stock" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rewards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reward_redemptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "status" "RewardRedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "fulfilledById" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rewards_organizationId_active_idx" ON "rewards"("organizationId", "active");

CREATE INDEX "reward_redemptions_organizationId_createdAt_idx" ON "reward_redemptions"("organizationId", "createdAt");
CREATE INDEX "reward_redemptions_rewardId_status_idx" ON "reward_redemptions"("rewardId", "status");
CREATE INDEX "reward_redemptions_userId_createdAt_idx" ON "reward_redemptions"("userId", "createdAt");

ALTER TABLE "rewards" ADD CONSTRAINT "rewards_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "rewards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
