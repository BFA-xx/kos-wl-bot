CREATE TABLE "x_verify_budget" (
  "month" TEXT NOT NULL,
  "reads" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "x_verify_budget_pkey" PRIMARY KEY ("month")
);
