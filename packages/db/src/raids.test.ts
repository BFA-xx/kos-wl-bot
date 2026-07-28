import assert from "node:assert/strict";
import test from "node:test";
import {
  RaidProofKind,
  RaidProofType,
  RaidSubmissionStatus,
} from "@prisma/client";
import {
  classifyRaidProof,
  inferRaidProofType,
  parseXStatusUrl,
} from "./raids.js";

const TARGET = "https://x.com/kos/status/100";

test("normalizes X and legacy Twitter status URLs", () => {
  assert.deepEqual(
    parseXStatusUrl("https://twitter.com/KOS_Official/status/123?s=20"),
    {
      url: "https://x.com/KOS_Official/status/123",
      handle: "KOS_Official",
      statusId: "123",
    },
  );
  assert.equal(parseXStatusUrl("https://example.com/status/123"), null);
});

test("infers a useful proof type from raid instructions", () => {
  assert.equal(inferRaidProofType("Reply with your favorite mint"), "COMMENT");
  assert.equal(inferRaidProofType("Quote tweet the announcement"), "QUOTE");
  assert.equal(inferRaidProofType("Repost this"), "REPOST");
  assert.equal(
    inferRaidProofType("Follow us and attach a screenshot"),
    "IMAGE",
  );
});

test("accepts the target link as repost-shaped proof", () => {
  const decision = classifyRaidProof({
    content: TARGET,
    imageCount: 0,
    targetUrls: [TARGET],
    proofType: RaidProofType.REPOST,
    instructions: "Repost",
  });
  assert.equal(decision.status, RaidSubmissionStatus.VALID);
  assert.equal(decision.kind, RaidProofKind.X_REPOST);
});

test("accepts a distinct status as comment-or-quote proof", () => {
  const decision = classifyRaidProof({
    content: "My proof https://x.com/member/status/200",
    imageCount: 0,
    targetUrls: [TARGET],
    proofType: RaidProofType.COMMENT,
    instructions: "Comment",
  });
  assert.equal(decision.status, RaidSubmissionStatus.VALID);
  assert.equal(decision.kind, RaidProofKind.X_COMMENT_OR_QUOTE);
});

test("holds screenshot evidence for staff review when a link is expected", () => {
  const decision = classifyRaidProof({
    content: "",
    imageCount: 1,
    targetUrls: [TARGET],
    proofType: RaidProofType.QUOTE,
    instructions: "Quote",
  });
  assert.equal(decision.status, RaidSubmissionStatus.PENDING);
  assert.equal(decision.kind, RaidProofKind.IMAGE);
});

test("rejects content without a recognized proof shape", () => {
  const decision = classifyRaidProof({
    content: "done!",
    imageCount: 0,
    targetUrls: [TARGET],
    proofType: RaidProofType.ANY,
    instructions: "",
  });
  assert.equal(decision.status, RaidSubmissionStatus.INVALID);
});
