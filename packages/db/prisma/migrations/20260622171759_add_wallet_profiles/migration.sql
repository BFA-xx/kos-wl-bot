-- AlterEnum
ALTER TYPE "WalletChain" ADD VALUE 'BASE';

-- CreateTable
CREATE TABLE "wallet_profiles" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "chain" "WalletChain" NOT NULL,
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wallet_profiles_userId_idx" ON "wallet_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_profiles_userId_chain_key" ON "wallet_profiles"("userId", "chain");

-- AddForeignKey
ALTER TABLE "wallet_profiles" ADD CONSTRAINT "wallet_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
