ALTER TABLE "identity_accounts" ADD COLUMN "accessToken" TEXT;
ALTER TABLE "identity_accounts" ADD COLUMN "refreshToken" TEXT;
ALTER TABLE "identity_accounts" ADD COLUMN "tokenExpiresAt" TIMESTAMP(3);

ALTER TYPE "IntegrationActionType" ADD VALUE 'X_IDENTITY_LINK';
