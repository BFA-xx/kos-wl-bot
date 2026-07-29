-- The Vercel dashboard and EC2 bot communicate only through PostgreSQL.
-- A request id makes bot acknowledgement compare-and-clear safe: a newer
-- dashboard request cannot be erased when an older scheduler run finishes.
ALTER TABLE "verification_settings"
  ADD COLUMN "desiredEnabled" BOOLEAN,
  ADD COLUMN "accessSyncRequested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "accessCleanupRoleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "panelPublishRequested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "controlRequestId" TEXT,
  ADD COLUMN "controlRequestedAt" TIMESTAMP(3),
  ADD COLUMN "controlRequestedById" TEXT,
  ADD COLUMN "controlProcessedAt" TIMESTAMP(3),
  ADD COLUMN "controlError" TEXT;

CREATE INDEX "verification_settings_controlRequestId_idx"
  ON "verification_settings"("controlRequestId");
