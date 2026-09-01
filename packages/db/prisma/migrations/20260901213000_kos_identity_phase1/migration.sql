CREATE TYPE "KosIdentityStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "KosOnboardingStatus" AS ENUM ('STARTED', 'PROFILE_COMPLETE', 'COMPLETED');
CREATE TYPE "IdentityProvider" AS ENUM ('TELEGRAM', 'DISCORD', 'X', 'WEBSITE', 'MINTOOOR');

CREATE TABLE "kos_identities" (
  "id" TEXT NOT NULL,
  "legacyUserId" TEXT,
  "displayName" TEXT NOT NULL,
  "status" "KosIdentityStatus" NOT NULL DEFAULT 'ACTIVE',
  "onboardingStatus" "KosOnboardingStatus" NOT NULL DEFAULT 'STARTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "kos_identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "identity_accounts" (
  "id" TEXT NOT NULL,
  "identityId" TEXT NOT NULL,
  "provider" "IdentityProvider" NOT NULL,
  "externalId" TEXT NOT NULL,
  "username" TEXT,
  "displayName" TEXT,
  "firstName" TEXT,
  "lastName" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "identity_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_rate_limit_buckets" (
  "id" TEXT NOT NULL,
  "telegramUserId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "telegram_rate_limit_buckets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kos_identities_legacyUserId_key" ON "kos_identities"("legacyUserId");
CREATE INDEX "kos_identities_status_createdAt_idx" ON "kos_identities"("status", "createdAt");
CREATE UNIQUE INDEX "identity_accounts_provider_externalId_key" ON "identity_accounts"("provider", "externalId");
CREATE UNIQUE INDEX "identity_accounts_identityId_provider_key" ON "identity_accounts"("identityId", "provider");
CREATE INDEX "identity_accounts_identityId_idx" ON "identity_accounts"("identityId");
CREATE UNIQUE INDEX "telegram_rate_limit_buckets_telegramUserId_scope_windowStart_key" ON "telegram_rate_limit_buckets"("telegramUserId", "scope", "windowStart");
CREATE INDEX "telegram_rate_limit_buckets_windowStart_idx" ON "telegram_rate_limit_buckets"("windowStart");

ALTER TABLE "kos_identities" ADD CONSTRAINT "kos_identities_legacyUserId_fkey" FOREIGN KEY ("legacyUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "identity_accounts" ADD CONSTRAINT "identity_accounts_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "kos_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
