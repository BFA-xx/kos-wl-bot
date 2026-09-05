-- CreateTable
CREATE TABLE "google_connections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "googleUserId" TEXT NOT NULL,
    "googleEmail" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "editorEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "connectedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winner_sheets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "spreadsheetUrl" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "winner_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winner_sheet_raffles" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "raffleId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "winner_sheet_raffles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_connections_organizationId_key" ON "google_connections"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "winner_sheets_spreadsheetId_key" ON "winner_sheets"("spreadsheetId");

-- CreateIndex
CREATE INDEX "winner_sheets_organizationId_syncedAt_idx" ON "winner_sheets"("organizationId", "syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "winner_sheet_raffles_raffleId_key" ON "winner_sheet_raffles"("raffleId");

-- CreateIndex
CREATE INDEX "winner_sheet_raffles_sheetId_idx" ON "winner_sheet_raffles"("sheetId");

-- AddForeignKey
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winner_sheets" ADD CONSTRAINT "winner_sheets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winner_sheets" ADD CONSTRAINT "winner_sheets_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "google_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winner_sheet_raffles" ADD CONSTRAINT "winner_sheet_raffles_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "winner_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winner_sheet_raffles" ADD CONSTRAINT "winner_sheet_raffles_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "raffles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
