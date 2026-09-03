CREATE TABLE "x_api_usage_logs" (
  "id" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'GET',
  "operation" TEXT NOT NULL,
  "resources" INTEGER NOT NULL DEFAULT 0,
  "estimatedCost" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "cached" BOOLEAN NOT NULL DEFAULT false,
  "statusCode" INTEGER,
  "durationMs" INTEGER,
  "outcome" TEXT,
  "organizationId" TEXT,
  "raffleId" INTEGER,
  "taskId" TEXT,
  "userId" TEXT,
  "xUserId" TEXT,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "x_api_usage_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "x_api_usage_logs_createdAt_idx" ON "x_api_usage_logs" ("createdAt");
CREATE INDEX "x_api_usage_logs_operation_createdAt_idx" ON "x_api_usage_logs" ("operation", "createdAt");
CREATE INDEX "x_api_usage_logs_taskId_createdAt_idx" ON "x_api_usage_logs" ("taskId", "createdAt");
CREATE INDEX "x_api_usage_logs_userId_createdAt_idx" ON "x_api_usage_logs" ("userId", "createdAt");
CREATE INDEX "x_api_usage_logs_raffleId_idx" ON "x_api_usage_logs" ("raffleId");
