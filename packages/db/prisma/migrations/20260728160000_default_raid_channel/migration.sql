-- Give Raids their own configurable per-server default channel.
ALTER TABLE "guilds" ADD COLUMN "defaultRaidChannelId" TEXT;

-- Preserve the channel Raids previously inherited from raffle defaults.
UPDATE "guilds"
SET "defaultRaidChannelId" = "defaultRaffleChannelId"
WHERE "defaultRaffleChannelId" IS NOT NULL;
