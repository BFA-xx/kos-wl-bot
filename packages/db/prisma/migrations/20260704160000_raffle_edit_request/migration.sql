-- Dashboard edit request → bot re-renders the post. Additive/nullable.
ALTER TABLE "raffles" ADD COLUMN "editRequestedAt" TIMESTAMP(3);
