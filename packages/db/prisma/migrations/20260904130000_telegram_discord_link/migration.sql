-- Additive and nullable: no rewrite, no default, no backfill.
ALTER TABLE "telegram_communities" ADD COLUMN "discordInviteUrl" TEXT;
ALTER TABLE "telegram_communities" ADD COLUMN "discordAccessCode" TEXT;
