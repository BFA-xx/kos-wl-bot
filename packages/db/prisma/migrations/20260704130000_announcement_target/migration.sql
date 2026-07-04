-- Announcement targeting: null = all orgs, else a specific org. Additive.
ALTER TABLE "announcements" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "announcements_organizationId_idx" ON "announcements"("organizationId");
