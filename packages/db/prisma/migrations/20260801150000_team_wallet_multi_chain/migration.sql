-- Allow one globally unique Team Wallet address to serve several compatible
-- raffle chains without duplicating its ownership, usage, or rotation state.
-- Keep the original chain column as a backward-compatible primary chain so
-- this additive migration remains safe while dashboard deployments roll over.

ALTER TABLE "team_wallets"
  ADD COLUMN "chains" "WalletChain"[] NOT NULL DEFAULT ARRAY[]::"WalletChain"[];

UPDATE "team_wallets"
SET "chains" = ARRAY["chain"]::"WalletChain"[]
WHERE cardinality("chains") = 0;
