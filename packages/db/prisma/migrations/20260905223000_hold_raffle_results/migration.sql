-- Allow a raffle to draw at close while keeping provisional winners private
-- until an authorized team member explicitly publishes the final result.
ALTER TABLE "raffles"
  ADD COLUMN "holdResults" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "resultsPublishedAt" TIMESTAMP(3),
  ADD COLUMN "resultsPublishRequestedAt" TIMESTAMP(3),
  ADD COLUMN "resultsPublishRequestedBy" TEXT;

-- Existing ended raffles have already published through the legacy completion
-- pipeline. Backfill them so post-release rerolls retain their public behavior.
UPDATE "raffles"
SET "resultsPublishedAt" = COALESCE("drawnAt", "endedAt", "updatedAt")
WHERE "status" = 'ENDED';

CREATE INDEX "raffles_resultsPublishRequestedAt_idx"
  ON "raffles"("resultsPublishRequestedAt");
