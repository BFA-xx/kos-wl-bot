-- Require a registered wallet to enter. Additive, default false.
ALTER TABLE "raffles" ADD COLUMN "requireWallet" BOOLEAN NOT NULL DEFAULT false;
