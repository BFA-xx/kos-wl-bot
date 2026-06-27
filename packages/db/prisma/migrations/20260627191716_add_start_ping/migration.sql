-- AlterTable
ALTER TABLE "raffles" ADD COLUMN     "startPing" TEXT NOT NULL DEFAULT 'everyone',
ADD COLUMN     "startPinged" BOOLEAN NOT NULL DEFAULT false;
