import {
  RaidProofKind,
  RaidProofType,
  RaidSubmissionStatus,
} from "@prisma/client";

export interface XStatusReference {
  url: string;
  handle: string;
  statusId: string;
}

export interface RaidProofDecision {
  status: RaidSubmissionStatus;
  kind: RaidProofKind;
  effectiveProofType: RaidProofType;
  reason: string;
  xStatuses: XStatusReference[];
}

const URL_PATTERN = /https?:\/\/[^\s<>()]+/giu;
const X_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
]);

/**
 * Normalize a public X/Twitter status URL and discard unrelated links. Query
 * strings and fragments are intentionally removed before persistence.
 */
export function parseXStatusUrl(value: string): XStatusReference | null {
  try {
    const url = new URL(value.trim().replace(/[),.!?]+$/u, ""));
    if (url.protocol !== "https:" || !X_HOSTS.has(url.hostname.toLowerCase())) {
      return null;
    }
    const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/u);
    if (!match) return null;
    const handle = match[1]!;
    const statusId = match[2]!;
    return {
      url: `https://x.com/${handle}/status/${statusId}`,
      handle,
      statusId,
    };
  } catch {
    return null;
  }
}

export function extractXStatusUrls(content: string): XStatusReference[] {
  const unique = new Map<string, XStatusReference>();
  for (const raw of content.match(URL_PATTERN) ?? []) {
    const parsed = parseXStatusUrl(raw);
    if (parsed) unique.set(parsed.statusId, parsed);
  }
  return [...unique.values()];
}

/** Infer the requested proof shape when a manager leaves proof type on Auto. */
export function inferRaidProofType(instructions: string): RaidProofType {
  const value = instructions.toLowerCase();
  if (/\b(screenshot|screen ?shot|follow)\b/u.test(value)) {
    return RaidProofType.IMAGE;
  }
  if (/\b(quote|quote[- ]?tweet)\b/u.test(value)) {
    return RaidProofType.QUOTE;
  }
  if (/\b(comment|reply|respond)\b/u.test(value)) {
    return RaidProofType.COMMENT;
  }
  if (/\b(repost|retweet|re-tweet)\b/u.test(value)) {
    return RaidProofType.REPOST;
  }
  return RaidProofType.ANY;
}

/**
 * Classify whether a Discord message has the proof shape requested by a raid.
 *
 * This is deliberately a shape verifier, matching KOS's current X
 * click-and-attest policy. A distinct X status can be a reply or quote; the URL
 * alone cannot distinguish those without paid X read access, so both are
 * represented honestly as X_COMMENT_OR_QUOTE. Screenshot-only evidence for a
 * link task is held for staff review instead of being rejected.
 */
export function classifyRaidProof(input: {
  content: string;
  imageCount: number;
  targetUrls: string[];
  proofType: RaidProofType;
  instructions: string;
}): RaidProofDecision {
  const xStatuses = extractXStatusUrls(input.content);
  const targetIds = new Set(
    input.targetUrls
      .map(parseXStatusUrl)
      .filter((item): item is XStatusReference => Boolean(item))
      .map((item) => item.statusId),
  );
  const hasTarget = xStatuses.some((item) => targetIds.has(item.statusId));
  const hasDistinctStatus = xStatuses.some(
    (item) => !targetIds.has(item.statusId),
  );
  const hasImage = input.imageCount > 0;
  const effectiveProofType =
    input.proofType === RaidProofType.AUTO
      ? inferRaidProofType(input.instructions)
      : input.proofType;

  let kind: RaidProofKind = RaidProofKind.UNKNOWN;
  if (hasImage && xStatuses.length > 0) kind = RaidProofKind.MIXED;
  else if (hasImage) kind = RaidProofKind.IMAGE;
  else if (hasDistinctStatus) kind = RaidProofKind.X_COMMENT_OR_QUOTE;
  else if (hasTarget) kind = RaidProofKind.X_REPOST;

  if (kind === RaidProofKind.UNKNOWN) {
    return {
      status: RaidSubmissionStatus.INVALID,
      kind,
      effectiveProofType,
      reason: "No X status link or image proof was detected.",
      xStatuses,
    };
  }

  if (effectiveProofType === RaidProofType.ANY) {
    return {
      status: RaidSubmissionStatus.VALID,
      kind,
      effectiveProofType,
      reason: "Recognized proof was submitted.",
      xStatuses,
    };
  }

  if (effectiveProofType === RaidProofType.IMAGE) {
    return {
      status: hasImage
        ? RaidSubmissionStatus.VALID
        : RaidSubmissionStatus.INVALID,
      kind,
      effectiveProofType,
      reason: hasImage
        ? "Image proof was detected."
        : "This raid requires image proof.",
      xStatuses,
    };
  }

  if (effectiveProofType === RaidProofType.REPOST) {
    return {
      status: hasTarget
        ? RaidSubmissionStatus.VALID
        : hasImage
          ? RaidSubmissionStatus.PENDING
          : RaidSubmissionStatus.INVALID,
      kind,
      effectiveProofType,
      reason: hasTarget
        ? "The raid post link was detected as repost proof."
        : hasImage
          ? "Screenshot proof needs staff review."
          : "Submit the original raid post link as repost proof.",
      xStatuses,
    };
  }

  const expectsCreatedStatus =
    effectiveProofType === RaidProofType.COMMENT ||
    effectiveProofType === RaidProofType.QUOTE;
  if (expectsCreatedStatus) {
    return {
      status: hasDistinctStatus
        ? RaidSubmissionStatus.VALID
        : hasImage
          ? RaidSubmissionStatus.PENDING
          : RaidSubmissionStatus.INVALID,
      kind,
      effectiveProofType,
      reason: hasDistinctStatus
        ? "A comment or quote status link was detected."
        : hasImage
          ? "Screenshot proof needs staff review."
          : "Submit the URL of your comment or quote post.",
      xStatuses,
    };
  }

  return {
    status: RaidSubmissionStatus.PENDING,
    kind,
    effectiveProofType,
    reason: "Proof needs staff review.",
    xStatuses,
  };
}
