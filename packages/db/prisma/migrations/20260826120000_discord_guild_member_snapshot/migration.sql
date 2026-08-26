-- CreateTable
CREATE TABLE "discord_guild_members" (
  "guildId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "globalName" TEXT,
  "nickname" TEXT,
  "displayName" TEXT NOT NULL,
  "avatarUrl" TEXT,
  "joinedAt" TIMESTAMP(3),
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "discord_guild_members_pkey" PRIMARY KEY ("guildId", "userId")
);

-- CreateIndex
CREATE INDEX "discord_guild_members_guildId_isActive_username_idx"
  ON "discord_guild_members"("guildId", "isActive", "username");
CREATE INDEX "discord_guild_members_userId_idx"
  ON "discord_guild_members"("userId");

-- AddForeignKey
ALTER TABLE "discord_guild_members"
  ADD CONSTRAINT "discord_guild_members_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "discord_guild_members"
  ADD CONSTRAINT "discord_guild_members_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
