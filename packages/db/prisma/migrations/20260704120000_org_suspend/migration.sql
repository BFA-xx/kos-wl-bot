-- Add org suspension flag (super-admin pause). Additive/nullable.
ALTER TABLE "organizations" ADD COLUMN "suspendedAt" TIMESTAMP(3);
