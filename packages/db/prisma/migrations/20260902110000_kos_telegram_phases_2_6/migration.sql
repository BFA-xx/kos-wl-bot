CREATE TYPE "KosPointEvent" AS ENUM (
  'USER_JOINED',
  'ONBOARDING_COMPLETED',
  'RAFFLE_ENTERED',
  'RAFFLE_WON',
  'REFERRAL_COMPLETED',
  'COMMUNITY_EVENT',
  'ADMIN_REWARD'
);

CREATE TYPE "KosReferralStatus" AS ENUM ('PENDING', 'COMPLETED', 'REJECTED');
CREATE TYPE "TelegramCommunityMemberStatus" AS ENUM ('ACTIVE', 'LEFT', 'BANNED');
CREATE TYPE "KosCommunityApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "TelegramConversationKind" AS ENUM ('QUICK_RAFFLE');
CREATE TYPE "KosModerationActionType" AS ENUM ('WARN', 'MUTE', 'BAN', 'UNBAN');

ALTER TABLE "kos_identities" ADD COLUMN "referralCode" TEXT;
CREATE UNIQUE INDEX "kos_identities_referralCode_key" ON "kos_identities"("referralCode");

CREATE TABLE "kos_reward_definitions" (
  "event" "KosPointEvent" NOT NULL,
  "points" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "kos_reward_definitions_pkey" PRIMARY KEY ("event"),
  CONSTRAINT "kos_reward_definitions_nonnegative" CHECK ("points" >= 0)
);

CREATE TABLE "kos_point_transactions" (
  "id" TEXT NOT NULL,
  "identityId" TEXT NOT NULL,
  "event" "KosPointEvent" NOT NULL,
  "amount" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "referenceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kos_point_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kos_point_transactions_identityId_event_source_referenceId_key"
  ON "kos_point_transactions"("identityId", "event", "source", "referenceId");
CREATE INDEX "kos_point_transactions_identityId_createdAt_idx"
  ON "kos_point_transactions"("identityId", "createdAt");
CREATE INDEX "kos_point_transactions_event_createdAt_idx"
  ON "kos_point_transactions"("event", "createdAt");

CREATE TABLE "kos_levels" (
  "level" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "minPoints" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "kos_levels_pkey" PRIMARY KEY ("level"),
  CONSTRAINT "kos_levels_nonnegative" CHECK ("level" > 0 AND "minPoints" >= 0)
);
CREATE UNIQUE INDEX "kos_levels_minPoints_key" ON "kos_levels"("minPoints");

CREATE TABLE "kos_referrals" (
  "id" TEXT NOT NULL,
  "referrerIdentityId" TEXT NOT NULL,
  "referredIdentityId" TEXT NOT NULL,
  "status" "KosReferralStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "kos_referrals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "kos_referrals_not_self" CHECK ("referrerIdentityId" <> "referredIdentityId")
);
CREATE UNIQUE INDEX "kos_referrals_referredIdentityId_key" ON "kos_referrals"("referredIdentityId");
CREATE INDEX "kos_referrals_referrerIdentityId_status_idx" ON "kos_referrals"("referrerIdentityId", "status");

CREATE TABLE "telegram_community_members" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "telegramUserId" TEXT NOT NULL,
  "identityId" TEXT,
  "status" "TelegramCommunityMemberStatus" NOT NULL DEFAULT 'ACTIVE',
  "approvalStatus" "KosCommunityApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "telegram_community_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "telegram_community_members_communityId_telegramUserId_key"
  ON "telegram_community_members"("communityId", "telegramUserId");
CREATE INDEX "telegram_community_members_identityId_idx" ON "telegram_community_members"("identityId");
CREATE INDEX "telegram_community_members_communityId_status_idx"
  ON "telegram_community_members"("communityId", "status");
CREATE INDEX "telegram_community_members_communityId_approvalStatus_requestedAt_idx"
  ON "telegram_community_members"("communityId", "approvalStatus", "requestedAt");

CREATE TABLE "telegram_conversations" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "telegramChatId" TEXT NOT NULL,
  "telegramUserId" TEXT NOT NULL,
  "kind" "TelegramConversationKind" NOT NULL,
  "step" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "telegram_conversations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "telegram_conversations_telegramChatId_telegramUserId_kind_key"
  ON "telegram_conversations"("telegramChatId", "telegramUserId", "kind");
CREATE INDEX "telegram_conversations_expiresAt_idx" ON "telegram_conversations"("expiresAt");

CREATE TABLE "kos_notification_preferences" (
  "identityId" TEXT NOT NULL,
  "announcements" BOOLEAN NOT NULL DEFAULT true,
  "raffleReminders" BOOLEAN NOT NULL DEFAULT true,
  "winners" BOOLEAN NOT NULL DEFAULT true,
  "points" BOOLEAN NOT NULL DEFAULT true,
  "community" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "kos_notification_preferences_pkey" PRIMARY KEY ("identityId")
);

CREATE TABLE "kos_moderation_actions" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "actorTelegramUserId" TEXT NOT NULL,
  "targetTelegramUserId" TEXT NOT NULL,
  "type" "KosModerationActionType" NOT NULL,
  "reason" TEXT,
  "durationSeconds" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kos_moderation_actions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "kos_moderation_actions_communityId_targetTelegramUserId_createdAt_idx"
  ON "kos_moderation_actions"("communityId", "targetTelegramUserId", "createdAt");
CREATE INDEX "kos_moderation_actions_communityId_actorTelegramUserId_createdAt_idx"
  ON "kos_moderation_actions"("communityId", "actorTelegramUserId", "createdAt");

ALTER TABLE "kos_point_transactions" ADD CONSTRAINT "kos_point_transactions_identityId_fkey"
  FOREIGN KEY ("identityId") REFERENCES "kos_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kos_referrals" ADD CONSTRAINT "kos_referrals_referrerIdentityId_fkey"
  FOREIGN KEY ("referrerIdentityId") REFERENCES "kos_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kos_referrals" ADD CONSTRAINT "kos_referrals_referredIdentityId_fkey"
  FOREIGN KEY ("referredIdentityId") REFERENCES "kos_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_community_members" ADD CONSTRAINT "telegram_community_members_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "telegram_communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_community_members" ADD CONSTRAINT "telegram_community_members_identityId_fkey"
  FOREIGN KEY ("identityId") REFERENCES "kos_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "telegram_conversations" ADD CONSTRAINT "telegram_conversations_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "telegram_communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kos_notification_preferences" ADD CONSTRAINT "kos_notification_preferences_identityId_fkey"
  FOREIGN KEY ("identityId") REFERENCES "kos_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kos_moderation_actions" ADD CONSTRAINT "kos_moderation_actions_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "telegram_communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "kos_reward_definitions" ("event", "points", "enabled", "updatedAt") VALUES
  ('USER_JOINED', 0, true, CURRENT_TIMESTAMP),
  ('ONBOARDING_COMPLETED', 100, true, CURRENT_TIMESTAMP),
  ('RAFFLE_ENTERED', 0, true, CURRENT_TIMESTAMP),
  ('RAFFLE_WON', 50, true, CURRENT_TIMESTAMP),
  ('REFERRAL_COMPLETED', 100, true, CURRENT_TIMESTAMP),
  ('COMMUNITY_EVENT', 0, true, CURRENT_TIMESTAMP);

INSERT INTO "kos_levels" ("level", "name", "minPoints", "updatedAt") VALUES
  (1, 'Member', 0, CURRENT_TIMESTAMP),
  (2, 'Contributor', 250, CURRENT_TIMESTAMP),
  (3, 'Builder', 500, CURRENT_TIMESTAMP),
  (4, 'Leader', 1000, CURRENT_TIMESTAMP),
  (5, 'KOS Elite', 2500, CURRENT_TIMESTAMP);

UPDATE "organization_roles"
SET "permissions" = array_append("permissions", 'telegram:moderate')
WHERE "isSystem" = true AND "name" IN ('Admin', 'Moderator')
  AND NOT ('telegram:moderate' = ANY("permissions"));
UPDATE "organization_roles"
SET "permissions" = array_append("permissions", 'telegram:announce')
WHERE "isSystem" = true AND "name" IN ('Admin', 'Moderator')
  AND NOT ('telegram:announce' = ANY("permissions"));
UPDATE "organization_roles"
SET "permissions" = array_append("permissions", 'points:award')
WHERE "isSystem" = true AND "name" = 'Admin'
  AND NOT ('points:award' = ANY("permissions"));
