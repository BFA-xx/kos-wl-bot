-- CreateEnum
CREATE TYPE "CollaborationStatus" AS ENUM ('LEAD', 'REACHED_OUT', 'NEGOTIATING', 'CONFIRMED', 'SCHEDULED', 'HOSTING', 'COLLECTING_WALLETS', 'READY_FOR_SUBMISSION', 'SUBMITTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CollaborationPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "CollaborationSubmissionStatus" AS ENUM ('NOT_STARTED', 'COLLECTING', 'READY', 'SUBMITTED', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CollaborationWalletStatus" AS ENUM ('WAITING', 'COLLECTED', 'SUBMITTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CollaborationReminderType" AS ENUM ('HOSTING', 'WALLET_SUBMISSION', 'COLLABORATION_DEADLINE', 'FOLLOW_UP', 'INACTIVE', 'CUSTOM');

-- Keep generated proof packages portable across the EC2 bot and Vercel. The
-- existing paths remain for bot-host cleanup, while authorized dashboard
-- downloads use these database-backed artifact copies.
ALTER TABLE "proofs"
ADD COLUMN "pdfData" BYTEA,
ADD COLUMN "csvData" BYTEA,
ADD COLUMN "cardData" BYTEA,
ADD COLUMN "artifactsStoredAt" TIMESTAMP(3),
ADD COLUMN "artifactSyncAttemptedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "collaboration_partners" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "logoUrl" TEXT,
    "websiteUrl" TEXT,
    "discordUrl" TEXT,
    "xUrl" TEXT,
    "chain" TEXT,
    "category" TEXT,
    "privateNotes" TEXT,
    "trustRating" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "collaboration_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaborations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "status" "CollaborationStatus" NOT NULL DEFAULT 'LEAD',
    "priority" "CollaborationPriority" NOT NULL DEFAULT 'MEDIUM',
    "submissionStatus" "CollaborationSubmissionStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "whitelistAllocation" INTEGER NOT NULL DEFAULT 0,
    "requirements" TEXT,
    "primaryContactName" TEXT,
    "discordUsername" TEXT,
    "telegram" TEXT,
    "email" TEXT,
    "ownerId" TEXT,
    "assignedToId" TEXT,
    "reviewerId" TEXT,
    "hostAt" TIMESTAMP(3),
    "hostingDeadline" TIMESTAMP(3),
    "walletSubmissionDeadline" TIMESTAMP(3),
    "collaborationDeadline" TIMESTAMP(3),
    "followUpAt" TIMESTAMP(3),
    "noResponseDays" INTEGER NOT NULL DEFAULT 5,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exportedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "collaborations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration_raffles" (
    "id" TEXT NOT NULL,
    "collaborationId" TEXT NOT NULL,
    "raffleId" INTEGER NOT NULL,
    "attachedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "collaboration_raffles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration_wallets" (
    "id" TEXT NOT NULL,
    "collaborationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "winnerId" INTEGER,
    "chain" "WalletChain",
    "status" "CollaborationWalletStatus" NOT NULL DEFAULT 'WAITING',
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "collaboration_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration_contacts" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "collaborationId" TEXT,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "discord" TEXT,
    "telegram" TEXT,
    "xUrl" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "conversation" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "collaboration_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration_notes" (
    "id" TEXT NOT NULL,
    "collaborationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "collaboration_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration_comments" (
    "id" TEXT NOT NULL,
    "collaborationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentionedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "collaboration_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration_attachments" (
    "id" TEXT NOT NULL,
    "collaborationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "kind" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "collaboration_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration_activities" (
    "id" TEXT NOT NULL,
    "collaborationId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "collaboration_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration_reminders" (
    "id" TEXT NOT NULL,
    "collaborationId" TEXT NOT NULL,
    "type" "CollaborationReminderType" NOT NULL,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "collaboration_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration_tags" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3B82F6',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "collaboration_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration_tag_assignments" (
    "collaborationId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    CONSTRAINT "collaboration_tag_assignments_pkey" PRIMARY KEY ("collaborationId","tagId")
);

-- CreateTable
CREATE TABLE "collaboration_saved_filters" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "view" TEXT NOT NULL DEFAULT 'TABLE',
    "criteria" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "collaboration_saved_filters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "collaboration_partners_organizationId_normalizedName_key" ON "collaboration_partners"("organizationId", "normalizedName");
CREATE INDEX "collaboration_partners_organizationId_updatedAt_idx" ON "collaboration_partners"("organizationId", "updatedAt");
CREATE INDEX "collaborations_organizationId_status_idx" ON "collaborations"("organizationId", "status");
CREATE INDEX "collaborations_organizationId_hostAt_idx" ON "collaborations"("organizationId", "hostAt");
CREATE INDEX "collaborations_organizationId_walletSubmissionDeadline_idx" ON "collaborations"("organizationId", "walletSubmissionDeadline");
CREATE INDEX "collaborations_organizationId_updatedAt_idx" ON "collaborations"("organizationId", "updatedAt");
CREATE INDEX "collaborations_partnerId_idx" ON "collaborations"("partnerId");
CREATE UNIQUE INDEX "collaboration_raffles_raffleId_key" ON "collaboration_raffles"("raffleId");
CREATE UNIQUE INDEX "collaboration_raffles_collaborationId_raffleId_key" ON "collaboration_raffles"("collaborationId", "raffleId");
CREATE INDEX "collaboration_raffles_collaborationId_idx" ON "collaboration_raffles"("collaborationId");
CREATE UNIQUE INDEX "collaboration_wallets_winnerId_key" ON "collaboration_wallets"("winnerId");
CREATE UNIQUE INDEX "collaboration_wallets_collaborationId_userId_key" ON "collaboration_wallets"("collaborationId", "userId");
CREATE INDEX "collaboration_wallets_collaborationId_status_idx" ON "collaboration_wallets"("collaborationId", "status");
CREATE INDEX "collaboration_wallets_userId_idx" ON "collaboration_wallets"("userId");
CREATE INDEX "collaboration_contacts_partnerId_idx" ON "collaboration_contacts"("partnerId");
CREATE INDEX "collaboration_contacts_collaborationId_idx" ON "collaboration_contacts"("collaborationId");
CREATE INDEX "collaboration_notes_collaborationId_pinned_createdAt_idx" ON "collaboration_notes"("collaborationId", "pinned", "createdAt");
CREATE INDEX "collaboration_comments_collaborationId_createdAt_idx" ON "collaboration_comments"("collaborationId", "createdAt");
CREATE UNIQUE INDEX "collaboration_attachments_url_key" ON "collaboration_attachments"("url");
CREATE INDEX "collaboration_attachments_collaborationId_createdAt_idx" ON "collaboration_attachments"("collaborationId", "createdAt");
CREATE INDEX "collaboration_activities_collaborationId_createdAt_idx" ON "collaboration_activities"("collaborationId", "createdAt");
CREATE INDEX "collaboration_reminders_collaborationId_dueAt_idx" ON "collaboration_reminders"("collaborationId", "dueAt");
CREATE INDEX "collaboration_reminders_dueAt_notifiedAt_idx" ON "collaboration_reminders"("dueAt", "notifiedAt");
CREATE UNIQUE INDEX "collaboration_tags_organizationId_normalizedName_key" ON "collaboration_tags"("organizationId", "normalizedName");
CREATE INDEX "collaboration_tags_organizationId_name_idx" ON "collaboration_tags"("organizationId", "name");
CREATE INDEX "collaboration_tag_assignments_tagId_idx" ON "collaboration_tag_assignments"("tagId");
CREATE INDEX "collaboration_saved_filters_organizationId_createdAt_idx" ON "collaboration_saved_filters"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "collaboration_partners" ADD CONSTRAINT "collaboration_partners_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaborations" ADD CONSTRAINT "collaborations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaborations" ADD CONSTRAINT "collaborations_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "collaboration_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "collaboration_raffles" ADD CONSTRAINT "collaboration_raffles_collaborationId_fkey" FOREIGN KEY ("collaborationId") REFERENCES "collaborations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_raffles" ADD CONSTRAINT "collaboration_raffles_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "raffles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_wallets" ADD CONSTRAINT "collaboration_wallets_collaborationId_fkey" FOREIGN KEY ("collaborationId") REFERENCES "collaborations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_wallets" ADD CONSTRAINT "collaboration_wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_wallets" ADD CONSTRAINT "collaboration_wallets_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "winners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "collaboration_contacts" ADD CONSTRAINT "collaboration_contacts_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "collaboration_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_contacts" ADD CONSTRAINT "collaboration_contacts_collaborationId_fkey" FOREIGN KEY ("collaborationId") REFERENCES "collaborations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_notes" ADD CONSTRAINT "collaboration_notes_collaborationId_fkey" FOREIGN KEY ("collaborationId") REFERENCES "collaborations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_comments" ADD CONSTRAINT "collaboration_comments_collaborationId_fkey" FOREIGN KEY ("collaborationId") REFERENCES "collaborations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_attachments" ADD CONSTRAINT "collaboration_attachments_collaborationId_fkey" FOREIGN KEY ("collaborationId") REFERENCES "collaborations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_activities" ADD CONSTRAINT "collaboration_activities_collaborationId_fkey" FOREIGN KEY ("collaborationId") REFERENCES "collaborations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_reminders" ADD CONSTRAINT "collaboration_reminders_collaborationId_fkey" FOREIGN KEY ("collaborationId") REFERENCES "collaborations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_tags" ADD CONSTRAINT "collaboration_tags_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_tag_assignments" ADD CONSTRAINT "collaboration_tag_assignments_collaborationId_fkey" FOREIGN KEY ("collaborationId") REFERENCES "collaborations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_tag_assignments" ADD CONSTRAINT "collaboration_tag_assignments_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "collaboration_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_saved_filters" ADD CONSTRAINT "collaboration_saved_filters_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing system roles predate Collab Hub. Add the new permissions without
-- changing custom roles or removing any permission already granted.
UPDATE "organization_roles"
SET "permissions" = "permissions" || ARRAY['collab:view','collab:create','collab:edit','collab:assign','collab:export','collab:archive']::TEXT[]
WHERE "isSystem" = true AND "name" = 'Admin';

UPDATE "organization_roles"
SET "permissions" = "permissions" || ARRAY['collab:view','collab:edit']::TEXT[]
WHERE "isSystem" = true AND "name" = 'Moderator';

UPDATE "organization_roles"
SET "permissions" = "permissions" || ARRAY['collab:view','collab:create','collab:edit','collab:assign','collab:export','collab:archive']::TEXT[]
WHERE "isSystem" = true AND "name" = 'Collab Manager';

UPDATE "organization_roles"
SET "permissions" = "permissions" || ARRAY['collab:view']::TEXT[]
WHERE "isSystem" = true AND "name" = 'Viewer';
