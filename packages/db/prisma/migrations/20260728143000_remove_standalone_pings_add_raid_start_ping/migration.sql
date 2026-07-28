-- Add the raffle-style start mention choice directly to Raids.
ALTER TABLE "raids"
ADD COLUMN "startPing" TEXT NOT NULL DEFAULT 'everyone';

-- Remove the mistakenly introduced standalone Ping workspace permissions.
UPDATE "organization_roles"
SET "permissions" = ARRAY(
  SELECT permission
  FROM unnest("permissions") AS permission
  WHERE permission NOT IN ('ping:view', 'ping:create', 'ping:edit')
)
WHERE "permissions" && ARRAY['ping:view', 'ping:create', 'ping:edit'];

-- The standalone Ping product was never intended. Production verification
-- confirmed this table was empty before the corrective release.
DROP TABLE "pings";
DROP TYPE "PingMentionMode";
DROP TYPE "PingStatus";
