-- Dashboard-requested reroll queue. Additive/nullable.
ALTER TABLE "raffles" ADD COLUMN "rerollRequest" JSONB;
ALTER TABLE "raffles" ADD COLUMN "rerollRequestedAt" TIMESTAMP(3);
