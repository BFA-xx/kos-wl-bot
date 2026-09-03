CREATE TYPE "XEngagementKind" AS ENUM ('LIKE', 'REPOST');

CREATE TABLE "x_engagement_sweeps" (
  "id" TEXT NOT NULL,
  "tweetId" TEXT NOT NULL,
  "kind" "XEngagementKind" NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  "complete" BOOLEAN NOT NULL DEFAULT false,
  "actorCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "x_engagement_sweeps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "x_engagement_sweeps_tweetId_kind_key"
  ON "x_engagement_sweeps" ("tweetId", "kind");

CREATE TABLE "x_engagement_actors" (
  "sweepId" TEXT NOT NULL,
  "xUserId" TEXT NOT NULL,
  CONSTRAINT "x_engagement_actors_pkey" PRIMARY KEY ("sweepId", "xUserId")
);

ALTER TABLE "x_engagement_actors"
  ADD CONSTRAINT "x_engagement_actors_sweepId_fkey"
  FOREIGN KEY ("sweepId") REFERENCES "x_engagement_sweeps"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
