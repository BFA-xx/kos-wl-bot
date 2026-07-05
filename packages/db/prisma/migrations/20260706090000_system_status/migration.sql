CREATE TABLE "system_status" (
    "key" TEXT NOT NULL,
    "value" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "system_status_pkey" PRIMARY KEY ("key")
);
