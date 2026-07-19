-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CampaignEnrollmentStatus" AS ENUM ('JOINED', 'COMPLETED');

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "completionPoints" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_tasks" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "campaign_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_raffles" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "raffleId" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "campaign_raffles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_enrollments" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "CampaignEnrollmentStatus" NOT NULL DEFAULT 'JOINED',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaigns_organizationId_status_idx" ON "campaigns"("organizationId", "status");
CREATE INDEX "campaigns_status_startAt_idx" ON "campaigns"("status", "startAt");
CREATE INDEX "campaigns_status_endAt_idx" ON "campaigns"("status", "endAt");
CREATE UNIQUE INDEX "campaign_tasks_campaignId_taskId_key" ON "campaign_tasks"("campaignId", "taskId");
CREATE INDEX "campaign_tasks_campaignId_position_idx" ON "campaign_tasks"("campaignId", "position");
CREATE INDEX "campaign_tasks_taskId_idx" ON "campaign_tasks"("taskId");
CREATE UNIQUE INDEX "campaign_raffles_campaignId_raffleId_key" ON "campaign_raffles"("campaignId", "raffleId");
CREATE INDEX "campaign_raffles_campaignId_position_idx" ON "campaign_raffles"("campaignId", "position");
CREATE INDEX "campaign_raffles_raffleId_idx" ON "campaign_raffles"("raffleId");
CREATE UNIQUE INDEX "campaign_enrollments_campaignId_userId_key" ON "campaign_enrollments"("campaignId", "userId");
CREATE INDEX "campaign_enrollments_userId_updatedAt_idx" ON "campaign_enrollments"("userId", "updatedAt");
CREATE INDEX "campaign_enrollments_campaignId_status_idx" ON "campaign_enrollments"("campaignId", "status");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_tasks" ADD CONSTRAINT "campaign_tasks_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_tasks" ADD CONSTRAINT "campaign_tasks_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_raffles" ADD CONSTRAINT "campaign_raffles_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_raffles" ADD CONSTRAINT "campaign_raffles_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "raffles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_enrollments" ADD CONSTRAINT "campaign_enrollments_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_enrollments" ADD CONSTRAINT "campaign_enrollments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Grant the new campaign permissions to existing built-in roles. Custom roles
-- remain unchanged so organization owners can delegate deliberately.
UPDATE "organization_roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT permission
  FROM unnest("permissions" || ARRAY['campaign:view', 'campaign:create', 'campaign:edit']) AS permission
)
WHERE "isSystem" = true AND "name" IN ('Owner', 'Admin', 'Collab Manager');

UPDATE "organization_roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT permission
  FROM unnest("permissions" || ARRAY['campaign:view', 'campaign:edit']) AS permission
)
WHERE "isSystem" = true AND "name" = 'Moderator';

UPDATE "organization_roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT permission
  FROM unnest("permissions" || ARRAY['campaign:view']) AS permission
)
WHERE "isSystem" = true AND "name" = 'Viewer';
