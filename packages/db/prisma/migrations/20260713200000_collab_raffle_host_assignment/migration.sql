-- Attribute imported collaboration history to the active team admin who
-- actually created/hosted the attached raffles. When a historical group ever
-- contains multiple hosts, prefer the host with the most attached rounds,
-- then the host of the most recently created round.
WITH host_counts AS (
  SELECT
    link."collaborationId",
    raffle."createdById",
    COUNT(*) AS "raffleCount",
    MAX(raffle."createdAt") AS "latestRaffleAt"
  FROM "collaboration_raffles" AS link
  JOIN "raffles" AS raffle ON raffle."id" = link."raffleId"
  GROUP BY link."collaborationId", raffle."createdById"
),
ranked_hosts AS (
  SELECT
    host_counts.*,
    ROW_NUMBER() OVER (
      PARTITION BY host_counts."collaborationId"
      ORDER BY
        host_counts."raffleCount" DESC,
        host_counts."latestRaffleAt" DESC,
        host_counts."createdById" ASC
    ) AS "hostRank"
  FROM host_counts
)
UPDATE "collaborations" AS collaboration
SET
  "ownerId" = ranked_hosts."createdById",
  "updatedAt" = CURRENT_TIMESTAMP
FROM ranked_hosts
WHERE ranked_hosts."collaborationId" = collaboration."id"
  AND ranked_hosts."hostRank" = 1
  AND EXISTS (
    SELECT 1
    FROM "collaboration_activities" AS activity
    WHERE activity."collaborationId" = collaboration."id"
      AND activity."action" = 'RAFFLE_HISTORY_IMPORTED'
  )
  AND EXISTS (
    SELECT 1
    FROM "organization_members" AS member
    WHERE member."organizationId" = collaboration."organizationId"
      AND member."userId" = ranked_hosts."createdById"
      AND member."status" = 'ACTIVE'
  );
