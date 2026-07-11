-- Add an optional public X profile to community branding.
ALTER TABLE "organizations" ADD COLUMN "xHandle" TEXT;
