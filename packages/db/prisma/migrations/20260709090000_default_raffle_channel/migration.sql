-- Add a configurable default channel for live raffle posts.
ALTER TABLE "guilds" ADD COLUMN "defaultRaffleChannelId" TEXT;
