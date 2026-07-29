-- Extend the existing immutable KOS audit categories.
ALTER TYPE "LogCategory" ADD VALUE IF NOT EXISTS 'VERIFICATION';

-- CreateEnum
CREATE TYPE "VerificationAttemptStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'EXPIRED'
);

-- CreateEnum
CREATE TYPE "VerificationLogStatus" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateTable
CREATE TABLE "verification_settings" (
  "guildId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "verificationChannelId" TEXT,
  "rulesChannelId" TEXT,
  "logChannelId" TEXT,
  "unverifiedRoleId" TEXT,
  "allowedChannelIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "defaultRoleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "welcomeTitle" TEXT NOT NULL DEFAULT 'Welcome to KOS.',
  "welcomeDescription" TEXT NOT NULL DEFAULT E'Before accessing the server, please verify yourself.\n\nClick the button below to continue.',
  "welcomeColor" INTEGER NOT NULL DEFAULT 12632256,
  "verifyButtonLabel" TEXT NOT NULL DEFAULT 'Verify',
  "verifyButtonEmoji" TEXT,
  "modalTitle" TEXT NOT NULL DEFAULT 'Verify Access',
  "modalFieldLabel" TEXT NOT NULL DEFAULT 'Verification Code',
  "modalPlaceholder" TEXT NOT NULL DEFAULT 'Enter your access code...',
  "requireCode" BOOLEAN NOT NULL DEFAULT true,
  "requireRulesAcceptance" BOOLEAN NOT NULL DEFAULT false,
  "preventCodeReuse" BOOLEAN NOT NULL DEFAULT true,
  "successMessage" TEXT NOT NULL DEFAULT 'Verification complete. Welcome to KOS.',
  "failureMessage" TEXT NOT NULL DEFAULT 'That verification code is invalid, expired, or unavailable.',
  "panelMessageId" TEXT,
  "panelPublishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "verification_settings_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "verification_codes" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT,
  "roleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "maxUses" INTEGER,
  "uses" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "oneTimePerMember" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_attempts" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeId" TEXT,
  "status" "VerificationAttemptStatus" NOT NULL DEFAULT 'PENDING',
  "rulesAcceptedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "verification_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_redemptions" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "codeId" TEXT,
  "attemptId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "roleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "verification_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_logs" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeId" TEXT,
  "code" TEXT,
  "status" "VerificationLogStatus" NOT NULL,
  "reason" TEXT,
  "roleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "rulesAcceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "verification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_verifications" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeId" TEXT,
  "roleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "rulesAcceptedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "member_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "verification_codes_guildId_code_key"
  ON "verification_codes"("guildId", "code");
CREATE INDEX "verification_codes_guildId_active_idx"
  ON "verification_codes"("guildId", "active");
CREATE INDEX "verification_codes_guildId_createdAt_idx"
  ON "verification_codes"("guildId", "createdAt");
CREATE INDEX "verification_attempts_guildId_userId_createdAt_idx"
  ON "verification_attempts"("guildId", "userId", "createdAt");
CREATE INDEX "verification_attempts_status_expiresAt_idx"
  ON "verification_attempts"("status", "expiresAt");
CREATE UNIQUE INDEX "verification_redemptions_attemptId_key"
  ON "verification_redemptions"("attemptId");
CREATE INDEX "verification_redemptions_guildId_userId_idx"
  ON "verification_redemptions"("guildId", "userId");
CREATE INDEX "verification_redemptions_codeId_redeemedAt_idx"
  ON "verification_redemptions"("codeId", "redeemedAt");
CREATE INDEX "verification_logs_guildId_createdAt_idx"
  ON "verification_logs"("guildId", "createdAt");
CREATE INDEX "verification_logs_guildId_userId_createdAt_idx"
  ON "verification_logs"("guildId", "userId", "createdAt");
CREATE UNIQUE INDEX "member_verifications_guildId_userId_key"
  ON "member_verifications"("guildId", "userId");
CREATE INDEX "member_verifications_guildId_verifiedAt_idx"
  ON "member_verifications"("guildId", "verifiedAt");

-- AddForeignKey
ALTER TABLE "verification_settings"
  ADD CONSTRAINT "verification_settings_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "verification_codes"
  ADD CONSTRAINT "verification_codes_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "verification_attempts"
  ADD CONSTRAINT "verification_attempts_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "verification_attempts"
  ADD CONSTRAINT "verification_attempts_codeId_fkey"
  FOREIGN KEY ("codeId") REFERENCES "verification_codes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "verification_redemptions"
  ADD CONSTRAINT "verification_redemptions_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "verification_redemptions"
  ADD CONSTRAINT "verification_redemptions_codeId_fkey"
  FOREIGN KEY ("codeId") REFERENCES "verification_codes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "verification_redemptions"
  ADD CONSTRAINT "verification_redemptions_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "verification_attempts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "verification_logs"
  ADD CONSTRAINT "verification_logs_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "verification_logs"
  ADD CONSTRAINT "verification_logs_codeId_fkey"
  FOREIGN KEY ("codeId") REFERENCES "verification_codes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "member_verifications"
  ADD CONSTRAINT "member_verifications_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "member_verifications"
  ADD CONSTRAINT "member_verifications_codeId_fkey"
  FOREIGN KEY ("codeId") REFERENCES "verification_codes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
