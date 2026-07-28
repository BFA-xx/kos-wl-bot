-- CreateEnum
CREATE TYPE "RaidStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RaidProofType" AS ENUM ('AUTO', 'COMMENT', 'QUOTE', 'REPOST', 'IMAGE', 'ANY');

-- CreateEnum
CREATE TYPE "RaidSubmissionStatus" AS ENUM ('PENDING', 'VALID', 'INVALID', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "RaidProofKind" AS ENUM ('X_REPOST', 'X_COMMENT_OR_QUOTE', 'IMAGE', 'MIXED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PingStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PingMentionMode" AS ENUM ('NONE', 'HERE', 'EVERYONE', 'ROLES');

-- CreateTable
CREATE TABLE "raids" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tweetUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "instructions" TEXT NOT NULL,
    "proofType" "RaidProofType" NOT NULL DEFAULT 'AUTO',
    "status" "RaidStatus" NOT NULL DEFAULT 'DRAFT',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "channelId" TEXT NOT NULL,
    "staffChannelId" TEXT,
    "messageId" TEXT,
    "threadId" TEXT,
    "rewardRoleId" TEXT,
    "rewardRoleName" TEXT NOT NULL,
    "rewardRoleCreated" BOOLEAN NOT NULL DEFAULT false,
    "participantLimit" INTEGER,
    "allowMultipleSubmissions" BOOLEAN NOT NULL DEFAULT false,
    "announcementMessage" TEXT,
    "validParticipantCount" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "summaryChannelId" TEXT,
    "summaryMessageId" TEXT,
    "roleAssignmentCount" INTEGER NOT NULL DEFAULT 0,
    "roleAssignmentFailedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "editRequestedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "raids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raid_participants" (
    "id" TEXT NOT NULL,
    "raidId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "RaidSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "roleAssignedAt" TIMESTAMP(3),
    "roleAssignmentError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "raid_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raid_submissions" (
    "id" TEXT NOT NULL,
    "raidId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "content" TEXT,
    "status" "RaidSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "proofKind" "RaidProofKind" NOT NULL DEFAULT 'UNKNOWN',
    "fingerprint" TEXT NOT NULL,
    "evidence" JSONB,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "raid_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raid_submission_attachments" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raid_submission_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "mentionMode" "PingMentionMode" NOT NULL DEFAULT 'NONE',
    "roleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linkUrl" TEXT,
    "status" "PingStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "sendingAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "messageId" TEXT,
    "failureReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "raids_organizationId_status_idx" ON "raids"("organizationId", "status");
CREATE INDEX "raids_guildId_status_idx" ON "raids"("guildId", "status");
CREATE INDEX "raids_status_startAt_idx" ON "raids"("status", "startAt");
CREATE INDEX "raids_status_endAt_idx" ON "raids"("status", "endAt");
CREATE INDEX "raids_threadId_idx" ON "raids"("threadId");
CREATE UNIQUE INDEX "raid_participants_raidId_userId_key" ON "raid_participants"("raidId", "userId");
CREATE INDEX "raid_participants_raidId_status_idx" ON "raid_participants"("raidId", "status");
CREATE INDEX "raid_participants_userId_updatedAt_idx" ON "raid_participants"("userId", "updatedAt");
CREATE UNIQUE INDEX "raid_submissions_messageId_key" ON "raid_submissions"("messageId");
CREATE INDEX "raid_submissions_raidId_status_idx" ON "raid_submissions"("raidId", "status");
CREATE INDEX "raid_submissions_raidId_userId_idx" ON "raid_submissions"("raidId", "userId");
CREATE INDEX "raid_submissions_participantId_createdAt_idx" ON "raid_submissions"("participantId", "createdAt");
CREATE INDEX "raid_submissions_raidId_fingerprint_idx" ON "raid_submissions"("raidId", "fingerprint");
CREATE INDEX "raid_submission_attachments_submissionId_idx" ON "raid_submission_attachments"("submissionId");
CREATE INDEX "pings_organizationId_status_idx" ON "pings"("organizationId", "status");
CREATE INDEX "pings_guildId_status_idx" ON "pings"("guildId", "status");
CREATE INDEX "pings_status_scheduledAt_idx" ON "pings"("status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "raids" ADD CONSTRAINT "raids_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "raids" ADD CONSTRAINT "raids_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "raid_participants" ADD CONSTRAINT "raid_participants_raidId_fkey" FOREIGN KEY ("raidId") REFERENCES "raids"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "raid_participants" ADD CONSTRAINT "raid_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "raid_submissions" ADD CONSTRAINT "raid_submissions_raidId_fkey" FOREIGN KEY ("raidId") REFERENCES "raids"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "raid_submissions" ADD CONSTRAINT "raid_submissions_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "raid_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "raid_submissions" ADD CONSTRAINT "raid_submissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "raid_submission_attachments" ADD CONSTRAINT "raid_submission_attachments_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "raid_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pings" ADD CONSTRAINT "pings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pings" ADD CONSTRAINT "pings_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Grant the new workspace permissions to existing built-in roles. Custom
-- roles remain unchanged so organization owners can delegate deliberately.
UPDATE "organization_roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT permission
  FROM unnest("permissions" || ARRAY[
    'raid:view', 'raid:create', 'raid:edit', 'raid:export',
    'ping:view', 'ping:create', 'ping:edit'
  ]) AS permission
)
WHERE "isSystem" = true AND "name" IN ('Owner', 'Admin', 'Collab Manager');

UPDATE "organization_roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT permission
  FROM unnest("permissions" || ARRAY[
    'raid:view', 'raid:create', 'raid:edit', 'raid:export',
    'ping:view', 'ping:create', 'ping:edit'
  ]) AS permission
)
WHERE "isSystem" = true AND "name" = 'Moderator';

UPDATE "organization_roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT permission
  FROM unnest("permissions" || ARRAY['raid:view', 'ping:view']) AS permission
)
WHERE "isSystem" = true AND "name" = 'Viewer';
