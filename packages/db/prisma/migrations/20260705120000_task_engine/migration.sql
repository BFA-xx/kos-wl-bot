-- Phase 3 S2: Task Verification Engine. Additive only.
CREATE TYPE "TaskType" AS ENUM ('X_FOLLOW','X_LIKE','X_REPOST','X_COMMENT','DISCORD_JOIN','DISCORD_ROLE','VISIT_LINK','MANUAL');
CREATE TYPE "CompletionStatus" AS ENUM ('PENDING','VERIFIED','REJECTED','NEEDS_REVIEW');

CREATE TABLE "task_definitions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "TaskType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "config" JSONB,
    "points" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "task_definitions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "task_definitions_organizationId_active_idx" ON "task_definitions"("organizationId", "active");
ALTER TABLE "task_definitions" ADD CONSTRAINT "task_definitions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "task_completions" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "CompletionStatus" NOT NULL DEFAULT 'PENDING',
    "evidence" JSONB,
    "verifiedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "task_completions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "task_completions_taskId_userId_key" ON "task_completions"("taskId", "userId");
CREATE INDEX "task_completions_userId_idx" ON "task_completions"("userId");
CREATE INDEX "task_completions_taskId_status_idx" ON "task_completions"("taskId", "status");
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "raffle_tasks" (
    "id" TEXT NOT NULL,
    "raffleId" INTEGER NOT NULL,
    "taskId" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "raffle_tasks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "raffle_tasks_raffleId_taskId_key" ON "raffle_tasks"("raffleId", "taskId");
CREATE INDEX "raffle_tasks_raffleId_idx" ON "raffle_tasks"("raffleId");
ALTER TABLE "raffle_tasks" ADD CONSTRAINT "raffle_tasks_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "raffles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "raffle_tasks" ADD CONSTRAINT "raffle_tasks_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
