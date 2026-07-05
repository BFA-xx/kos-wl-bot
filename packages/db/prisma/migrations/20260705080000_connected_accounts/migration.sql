-- Phase 3 S1: universal account linking. Additive only.
CREATE TYPE "AccountProvider" AS ENUM ('X', 'TELEGRAM', 'GITHUB');

CREATE TABLE "connected_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AccountProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "connected_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "connected_accounts_provider_externalId_key" ON "connected_accounts"("provider", "externalId");
CREATE UNIQUE INDEX "connected_accounts_userId_provider_key" ON "connected_accounts"("userId", "provider");
CREATE INDEX "connected_accounts_userId_idx" ON "connected_accounts"("userId");

ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
