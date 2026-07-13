-- Discord interaction attachment URLs expire. Preserve new raffle banners in
-- shared PostgreSQL storage so the EC2 bot and Vercel dashboard use one durable
-- public image without adding another runtime secret.
CREATE TABLE "raffle_banner_assets" (
    "raffleId" INTEGER NOT NULL,
    "sourceUrl" TEXT,
    "contentType" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "storedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raffle_banner_assets_pkey" PRIMARY KEY ("raffleId")
);

ALTER TABLE "raffle_banner_assets"
ADD CONSTRAINT "raffle_banner_assets_raffleId_fkey"
FOREIGN KEY ("raffleId") REFERENCES "raffles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
