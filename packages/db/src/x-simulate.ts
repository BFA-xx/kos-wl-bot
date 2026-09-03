import { estimateCost } from "./x-pricing.js";

/**
 * Estimate what a raffle will cost in X API credits before it is launched.
 *
 * Every number here is a projection from the rate table, not a quote. The
 * assumptions are stated in the returned `assumptions` array so a figure can
 * never be read as authoritative without also reading what produced it.
 *
 * The comparison that matters is `withCaching` against `withoutCaching`: the
 * second is what the same raffle would cost if every verify click went straight
 * to X, which is what the implementation did before the caching layer existed.
 */

/** Engagers returned per sweep page — X's maximum. */
const SWEEP_PAGE_SIZE = 100;

export interface XSimulationInput {
  participants: number;
  followTasks?: number;
  likeTasks?: number;
  repostTasks?: number;
  /** Winners re-validated at draw time (stage 2). */
  winnerCount?: number;
  /** Expected engagers on each like/repost post, for sweep sizing. */
  engagersPerPost?: number;
  /** How long the raffle runs, which sets how often a sweep goes stale. */
  raffleDurationHours?: number;
  /** Cached sweep lifetime. Mirrors X_SWEEP_TTL_MINUTES. */
  sweepTtlMinutes?: number;
  /** Hard cap on pages per sweep. Mirrors X_SWEEP_MAX_PAGES. */
  sweepMaxPages?: number;
  /**
   * Times an average participant hits Verify on a task they have not completed
   * yet. This is what the cooldown collapses, so it drives the saving.
   */
  attemptsPerParticipant?: number;
}

export interface XSimulationLine {
  label: string;
  requests: number;
  resources: number;
  estimatedCostUsd: number;
}

export interface XSimulationResult {
  withCaching: {
    lines: XSimulationLine[];
    requests: number;
    estimatedCostUsd: number;
    costPerParticipantUsd: number;
  };
  withoutCaching: {
    requests: number;
    estimatedCostUsd: number;
    costPerParticipantUsd: number;
  };
  estimatedSavingsUsd: number;
  assumptions: string[];
}

const round = (n: number) => Number(n.toFixed(4));

export function simulateRaffleCost(input: XSimulationInput): XSimulationResult {
  const participants = Math.max(0, Math.floor(input.participants));
  const followTasks = Math.max(0, Math.floor(input.followTasks ?? 0));
  const likeTasks = Math.max(0, Math.floor(input.likeTasks ?? 0));
  const repostTasks = Math.max(0, Math.floor(input.repostTasks ?? 0));
  const winnerCount = Math.max(0, Math.floor(input.winnerCount ?? 0));
  const engagersPerPost = Math.max(0, Math.floor(input.engagersPerPost ?? participants));
  const durationHours = Math.max(1, input.raffleDurationHours ?? 72);
  const ttlMinutes = Math.max(1, input.sweepTtlMinutes ?? 360);
  const maxPages = Math.max(1, input.sweepMaxPages ?? 20);
  const attempts = Math.max(1, input.attemptsPerParticipant ?? 3);

  const lines: XSimulationLine[] = [];
  const assumptions: string[] = [];

  // --- Follows: one paid check per participant per target, then cached. ---
  const followRequests = participants * followTasks;
  if (followTasks > 0) {
    lines.push({
      label: `Follow checks (${followTasks} target${followTasks === 1 ? "" : "s"})`,
      requests: followRequests,
      resources: followRequests,
      estimatedCostUsd: round(estimateCost("follow_check", followRequests)),
    });
    assumptions.push(
      "One paid follow check per participant per target. A VERIFIED result is cached forever, so nobody is charged twice for the same pass.",
    );
    assumptions.push(
      "X deduplicates identical resources within a 24h UTC window. If that applies to connection_status lookups, real follow cost could be far lower than shown — this projection does NOT assume it.",
    );
  }

  // --- Sweeps: cost belongs to the post, shared by every participant. ---
  const posts = likeTasks + repostTasks;
  let sweepRequests = 0;
  let sweepResources = 0;
  let sweepCost = 0;
  if (posts > 0) {
    // A sweep runs only when the cache is stale AND somebody verifies, so the
    // count is bounded by the TTL windows in the raffle and by the number of
    // verifies. This is the WORST case — every window containing a verify. The
    // best case is a single sweep, and the gap between them is entirely
    // controlled by X_SWEEP_TTL_MINUTES.
    const windows = Math.ceil((durationHours * 60) / ttlMinutes);
    const sweepsPerPost = Math.max(1, Math.min(windows, participants));
    const pagesPerSweep = Math.min(
      maxPages,
      Math.max(1, Math.ceil(engagersPerPost / SWEEP_PAGE_SIZE)),
    );

    const metricsRequests = posts * sweepsPerPost;
    const pageRequests = posts * sweepsPerPost * pagesPerSweep;
    const pageResources = pageRequests * SWEEP_PAGE_SIZE;

    sweepRequests = metricsRequests + pageRequests;
    sweepResources = metricsRequests + pageResources;
    sweepCost =
      estimateCost("post_metrics", metricsRequests) +
      estimateCost("engager_sweep_page", pageResources);

    lines.push({
      label: `Engager sweeps, worst case (${posts} post${posts === 1 ? "" : "s"}, up to ${sweepsPerPost}x each)`,
      requests: sweepRequests,
      resources: sweepResources,
      estimatedCostUsd: round(sweepCost),
    });
    assumptions.push(
      `Each post is swept at most once per ${ttlMinutes}-minute window and shared by every participant, so sweep cost scales with the post and the raffle's LENGTH, not with entrants.`,
    );
    assumptions.push(
      `Sweeps are the expensive half: one sweep of a ${engagersPerPost}-engager post costs about $${estimateCost("engager_sweep_page", Math.min(maxPages, Math.max(1, Math.ceil(engagersPerPost / SWEEP_PAGE_SIZE))) * SWEEP_PAGE_SIZE).toFixed(2)}. Raising X_SWEEP_TTL_MINUTES is the single most effective cost lever; the best case is one sweep for the whole raffle.`,
    );
    if (engagersPerPost > maxPages * SWEEP_PAGE_SIZE) {
      assumptions.push(
        `At ${engagersPerPost} engagers the post exceeds the ${maxPages}-page cap (${maxPages * SWEEP_PAGE_SIZE} engagers), so sweeps stay incomplete and those members fall back to attest. Cost is capped; certainty is not.`,
      );
    }
  }

  // --- Stage 2: only winners are re-validated. ---
  const winnerRequests = Math.min(winnerCount, participants) * followTasks;
  if (winnerRequests > 0) {
    lines.push({
      label: `Winner re-validation (${winnerCount} winners)`,
      requests: winnerRequests,
      resources: winnerRequests,
      estimatedCostUsd: round(estimateCost("follow_check", winnerRequests)),
    });
    assumptions.push(
      "Only drawn winners are re-checked at the end, never the whole entrant list.",
    );
  }

  const requests = lines.reduce((sum, l) => sum + l.requests, 0);
  const estimatedCostUsd = round(lines.reduce((sum, l) => sum + l.estimatedCostUsd, 0));

  // --- The counterfactual: no caching, no cooldown, no sweep sharing. ---
  const noCacheFollow = participants * followTasks * attempts;
  const noCacheSweepPages = Math.min(
    maxPages,
    Math.max(1, Math.ceil(engagersPerPost / SWEEP_PAGE_SIZE)),
  );
  const noCacheSweepRequests = participants * posts * attempts * (1 + noCacheSweepPages);
  const noCacheCost =
    estimateCost("follow_check", noCacheFollow) +
    estimateCost("post_metrics", participants * posts * attempts) +
    estimateCost(
      "engager_sweep_page",
      participants * posts * attempts * noCacheSweepPages * SWEEP_PAGE_SIZE,
    );
  const withoutRequests = noCacheFollow + noCacheSweepRequests;

  if (posts > 0 || followTasks > 0) {
    assumptions.push(
      `"Without caching" assumes ${attempts} verify attempts per participant per task going straight to X — the behaviour before the cooldown and sweep cache existed.`,
    );
  }
  assumptions.push(
    "Estimates only. X publishes no balance endpoint; the Developer Console is the authority on money actually spent.",
  );

  return {
    withCaching: {
      lines,
      requests,
      estimatedCostUsd,
      costPerParticipantUsd:
        participants > 0 ? round(estimatedCostUsd / participants) : 0,
    },
    withoutCaching: {
      requests: withoutRequests,
      estimatedCostUsd: round(noCacheCost),
      costPerParticipantUsd:
        participants > 0 ? round(noCacheCost / participants) : 0,
    },
    estimatedSavingsUsd: round(noCacheCost - estimatedCostUsd),
    assumptions,
  };
}
