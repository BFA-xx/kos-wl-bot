-- Extend universal account linking with provider-neutral display and verification metadata.
ALTER TABLE "connected_accounts"
  ALTER COLUMN "handle" DROP NOT NULL,
  ADD COLUMN "displayName" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "lastSeenAt" TIMESTAMP(3);

CREATE TYPE "TelegramCommunityStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "TelegramWinnerVisibility" AS ENUM ('PUBLIC', 'ANONYMOUS', 'ADMIN_ONLY');
CREATE TYPE "RaffleEligibilityProvider" AS ENUM ('TELEGRAM', 'KOS');
CREATE TYPE "RaffleEligibilityType" AS ENUM ('TELEGRAM_CHAT_MEMBER', 'TELEGRAM_CHAT_STATUS', 'KOS_ACCOUNT_LINKED', 'INVITE_ONLY');
CREATE TYPE "RaffleEligibilityCheckAt" AS ENUM ('ENTRY', 'DRAW', 'BOTH');
CREATE TYPE "TelegramUpdateStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');
CREATE TYPE "IntegrationActionType" AS ENUM ('TELEGRAM_LINK', 'TELEGRAM_ENTER');
CREATE TYPE "IntegrationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');
CREATE TYPE "IntegrationDeliveryEvent" AS ENUM ('RAFFLE_CREATED', 'RAFFLE_STARTING', 'RAFFLE_ENDING_SOON', 'RAFFLE_COMPLETED', 'WINNER_SELECTED', 'RAFFLE_CANCELLED');

CREATE TABLE "telegram_communities" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "backingGuildId" TEXT NOT NULL,
  "telegramChatId" TEXT NOT NULL,
  "communityName" TEXT NOT NULL,
  "status" "TelegramCommunityStatus" NOT NULL DEFAULT 'ACTIVE',
  "featureFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "defaultRaffleSettings" JSONB,
  "botVerifiedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "telegram_communities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_raffle_publications" (
  "id" TEXT NOT NULL,
  "raffleId" INTEGER NOT NULL,
  "communityId" TEXT NOT NULL,
  "telegramMessageId" TEXT,
  "winnerVisibility" "TelegramWinnerVisibility" NOT NULL DEFAULT 'PUBLIC',
  "autoAnnouncements" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "telegram_raffle_publications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "raffle_eligibility_rules" (
  "id" TEXT NOT NULL,
  "raffleId" INTEGER NOT NULL,
  "publicationId" TEXT,
  "provider" "RaffleEligibilityProvider" NOT NULL,
  "type" "RaffleEligibilityType" NOT NULL,
  "config" JSONB,
  "checkAt" "RaffleEligibilityCheckAt" NOT NULL DEFAULT 'ENTRY',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "raffle_eligibility_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_update_receipts" (
  "id" TEXT NOT NULL,
  "botKey" TEXT NOT NULL DEFAULT 'main',
  "updateId" INTEGER NOT NULL,
  "status" "TelegramUpdateStatus" NOT NULL DEFAULT 'RECEIVED',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "error" TEXT,
  CONSTRAINT "telegram_update_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_action_tokens" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT,
  "action" "IntegrationActionType" NOT NULL,
  "userId" TEXT,
  "publicationId" TEXT,
  "payload" JSONB,
  "singleUse" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_action_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_deliveries" (
  "id" TEXT NOT NULL,
  "event" "IntegrationDeliveryEvent" NOT NULL,
  "status" "IntegrationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "communityId" TEXT NOT NULL,
  "publicationId" TEXT,
  "raffleId" INTEGER,
  "dedupeKey" TEXT NOT NULL,
  "payload" JSONB,
  "notBefore" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lockedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_communities_telegramChatId_key" ON "telegram_communities"("telegramChatId");
CREATE INDEX "telegram_communities_organizationId_status_idx" ON "telegram_communities"("organizationId", "status");
CREATE INDEX "telegram_communities_backingGuildId_idx" ON "telegram_communities"("backingGuildId");
CREATE UNIQUE INDEX "telegram_raffle_publications_raffleId_communityId_key" ON "telegram_raffle_publications"("raffleId", "communityId");
CREATE INDEX "telegram_raffle_publications_communityId_createdAt_idx" ON "telegram_raffle_publications"("communityId", "createdAt");
CREATE UNIQUE INDEX "raffle_eligibility_rules_publicationId_type_key" ON "raffle_eligibility_rules"("publicationId", "type");
CREATE INDEX "raffle_eligibility_rules_raffleId_provider_checkAt_idx" ON "raffle_eligibility_rules"("raffleId", "provider", "checkAt");
CREATE UNIQUE INDEX "telegram_update_receipts_botKey_updateId_key" ON "telegram_update_receipts"("botKey", "updateId");
CREATE INDEX "telegram_update_receipts_status_receivedAt_idx" ON "telegram_update_receipts"("status", "receivedAt");
CREATE UNIQUE INDEX "integration_action_tokens_tokenHash_key" ON "integration_action_tokens"("tokenHash");
CREATE UNIQUE INDEX "integration_action_tokens_publicationId_key" ON "integration_action_tokens"("publicationId");
CREATE INDEX "integration_action_tokens_action_expiresAt_idx" ON "integration_action_tokens"("action", "expiresAt");
CREATE INDEX "integration_action_tokens_userId_action_idx" ON "integration_action_tokens"("userId", "action");
CREATE UNIQUE INDEX "integration_deliveries_dedupeKey_key" ON "integration_deliveries"("dedupeKey");
CREATE INDEX "integration_deliveries_status_notBefore_idx" ON "integration_deliveries"("status", "notBefore");
CREATE INDEX "integration_deliveries_communityId_createdAt_idx" ON "integration_deliveries"("communityId", "createdAt");
CREATE INDEX "integration_deliveries_raffleId_event_idx" ON "integration_deliveries"("raffleId", "event");

ALTER TABLE "telegram_communities" ADD CONSTRAINT "telegram_communities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_communities" ADD CONSTRAINT "telegram_communities_backingGuildId_fkey" FOREIGN KEY ("backingGuildId") REFERENCES "guilds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "telegram_raffle_publications" ADD CONSTRAINT "telegram_raffle_publications_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "raffles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_raffle_publications" ADD CONSTRAINT "telegram_raffle_publications_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "telegram_communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "raffle_eligibility_rules" ADD CONSTRAINT "raffle_eligibility_rules_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "raffles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "raffle_eligibility_rules" ADD CONSTRAINT "raffle_eligibility_rules_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "telegram_raffle_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_action_tokens" ADD CONSTRAINT "integration_action_tokens_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "telegram_raffle_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_deliveries" ADD CONSTRAINT "integration_deliveries_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "telegram_communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_deliveries" ADD CONSTRAINT "integration_deliveries_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "telegram_raffle_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_deliveries" ADD CONSTRAINT "integration_deliveries_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "raffles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
