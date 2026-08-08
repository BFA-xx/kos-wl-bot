ALTER TABLE "collaboration_partners"
ADD COLUMN "bannerUrl" TEXT,
ADD COLUMN "bio" TEXT,
ADD COLUMN "xVerified" BOOLEAN NOT NULL DEFAULT false;
