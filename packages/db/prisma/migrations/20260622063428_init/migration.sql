-- CreateEnum
CREATE TYPE "RaffleStatus" AS ENUM ('DRAFT', 'UPCOMING', 'LIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RoleMatchMode" AS ENUM ('ANY', 'ALL');

-- CreateEnum
CREATE TYPE "WalletChain" AS ENUM ('ETHEREUM', 'SOLANA', 'BITCOIN');

-- CreateEnum
CREATE TYPE "LogCategory" AS ENUM ('RAFFLE', 'ENTRY', 'WINNER', 'REROLL', 'WALLET', 'BLACKLIST', 'ADMIN', 'SYSTEM');

-- CreateTable
CREATE TABLE "guilds" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "iconUrl" TEXT,
    "managerRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultAnnounceChannelId" TEXT,
    "defaultProofChannelId" TEXT,
    "logChannelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guilds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "globalName" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raffles" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "spots" INTEGER NOT NULL,
    "roleMatchMode" "RoleMatchMode" NOT NULL DEFAULT 'ANY',
    "status" "RaffleStatus" NOT NULL DEFAULT 'UPCOMING',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "channelId" TEXT,
    "messageId" TEXT,
    "announceChannelId" TEXT,
    "proofChannelId" TEXT,
    "bannerUrl" TEXT,
    "externalUrl" TEXT,
    "requirements" JSONB,
    "collectWallets" BOOLEAN NOT NULL DEFAULT true,
    "walletChains" "WalletChain"[] DEFAULT ARRAY['ETHEREUM']::"WalletChain"[],
    "entryCount" INTEGER NOT NULL DEFAULT 0,
    "drawSeed" TEXT,
    "drawSeedHash" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "drawnAt" TIMESTAMP(3),

    CONSTRAINT "raffles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raffle_roles" (
    "id" SERIAL NOT NULL,
    "raffleId" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,

    CONSTRAINT "raffle_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participants" (
    "id" SERIAL NOT NULL,
    "raffleId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountCreatedAt" TIMESTAMP(3),
    "joinedGuildAt" TIMESTAMP(3),
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "flagReason" TEXT,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winners" (
    "id" SERIAL NOT NULL,
    "raffleId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromReroll" BOOLEAN NOT NULL DEFAULT false,
    "replaced" BOOLEAN NOT NULL DEFAULT false,
    "participantId" INTEGER,

    CONSTRAINT "winners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "winnerId" INTEGER,
    "chain" "WalletChain" NOT NULL,
    "address" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blacklists" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blacklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proofs" (
    "id" SERIAL NOT NULL,
    "raffleId" INTEGER NOT NULL,
    "messageLink" TEXT,
    "pdfPath" TEXT,
    "csvPath" TEXT,
    "cardPath" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logs" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "raffleId" INTEGER,
    "actorId" TEXT,
    "category" "LogCategory" NOT NULL,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "raffles_guildId_status_idx" ON "raffles"("guildId", "status");

-- CreateIndex
CREATE INDEX "raffles_status_endAt_idx" ON "raffles"("status", "endAt");

-- CreateIndex
CREATE INDEX "raffles_status_startAt_idx" ON "raffles"("status", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "raffle_roles_raffleId_roleId_key" ON "raffle_roles"("raffleId", "roleId");

-- CreateIndex
CREATE INDEX "participants_raffleId_idx" ON "participants"("raffleId");

-- CreateIndex
CREATE UNIQUE INDEX "participants_raffleId_userId_key" ON "participants"("raffleId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "winners_participantId_key" ON "winners"("participantId");

-- CreateIndex
CREATE INDEX "winners_raffleId_idx" ON "winners"("raffleId");

-- CreateIndex
CREATE INDEX "winners_raffleId_userId_idx" ON "winners"("raffleId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_winnerId_key" ON "wallets"("winnerId");

-- CreateIndex
CREATE INDEX "wallets_userId_idx" ON "wallets"("userId");

-- CreateIndex
CREATE INDEX "blacklists_guildId_idx" ON "blacklists"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "blacklists_guildId_userId_key" ON "blacklists"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "proofs_raffleId_key" ON "proofs"("raffleId");

-- CreateIndex
CREATE INDEX "logs_guildId_createdAt_idx" ON "logs"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "logs_raffleId_idx" ON "logs"("raffleId");

-- AddForeignKey
ALTER TABLE "raffles" ADD CONSTRAINT "raffles_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raffle_roles" ADD CONSTRAINT "raffle_roles_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "raffles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "raffles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winners" ADD CONSTRAINT "winners_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "raffles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winners" ADD CONSTRAINT "winners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winners" ADD CONSTRAINT "winners_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "winners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blacklists" ADD CONSTRAINT "blacklists_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blacklists" ADD CONSTRAINT "blacklists_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proofs" ADD CONSTRAINT "proofs_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "raffles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logs" ADD CONSTRAINT "logs_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logs" ADD CONSTRAINT "logs_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "raffles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
