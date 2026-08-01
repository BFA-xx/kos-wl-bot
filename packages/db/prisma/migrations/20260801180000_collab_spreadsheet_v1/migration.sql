-- Spreadsheet-specific collaboration fields. Existing whitelistAllocation is
-- retained as the GTD allocation so historical raffle and wallet automation
-- continues to use the same source of truth.
ALTER TABLE "collaborations"
  ADD COLUMN "fcfsSpots" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "documentUrl" TEXT;
