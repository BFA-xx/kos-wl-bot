-- Historical raffle imports were initially attributed to the organization
-- owner even when an active admin performed the import. Make the importing
-- teammate the collaboration lead while leaving manually created records
-- untouched.
UPDATE "collaborations" AS collaboration
SET
  "ownerId" = collaboration."createdById",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "organizations" AS organization
WHERE collaboration."organizationId" = organization."id"
  AND collaboration."ownerId" = organization."ownerId"
  AND EXISTS (
    SELECT 1
    FROM "organization_members" AS member
    WHERE member."organizationId" = collaboration."organizationId"
      AND member."userId" = collaboration."createdById"
      AND member."status" = 'ACTIVE'
  )
  AND EXISTS (
    SELECT 1
    FROM "collaboration_activities" AS activity
    WHERE activity."collaborationId" = collaboration."id"
      AND activity."action" = 'RAFFLE_HISTORY_IMPORTED'
  );

-- Imported raffle banners are not project logos, and Discord interaction
-- attachment URLs expire. Remove only banner-derived logos and the generic
-- category label; manually supplied partner branding remains untouched.
UPDATE "collaboration_partners"
SET
  "category" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE LOWER(TRIM("category")) = 'raffle partner';

UPDATE "collaboration_partners" AS partner
SET
  "logoUrl" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1
  FROM "collaborations" AS collaboration
  JOIN "collaboration_activities" AS activity
    ON activity."collaborationId" = collaboration."id"
    AND activity."action" = 'RAFFLE_HISTORY_IMPORTED'
  JOIN "collaboration_raffles" AS link
    ON link."collaborationId" = collaboration."id"
  JOIN "raffles" AS raffle
    ON raffle."id" = link."raffleId"
  WHERE collaboration."partnerId" = partner."id"
    AND raffle."bannerUrl" = partner."logoUrl"
);
