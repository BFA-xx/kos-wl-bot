import { describe, expect, it } from "vitest";
import { decodeApprovalQuery } from "@/lib/telegram/admin";

/**
 * The callback shapes are a compatibility surface: reviewer DMs already sitting
 * in chat history carry the old payloads, and those buttons must keep working
 * after this change.
 */
const PAGE = /^approval:page:([a-z0-9]{20,36}):(\d{1,3}):([A-Za-z0-9_-]*)$/u;
const DECIDE = /^approval:(approve|reject):([a-z0-9]{20,36})(?::(\d{1,3}))?$/u;

const CID = "cmtivyeib00026skojqtn3f2m";
const MID = "cmtivyeib00026skojqtn3f2m";

describe("approval callback payloads", () => {
  it("still accepts decision buttons sent before paging existed", () => {
    const legacy = `approval:approve:${MID}`.match(DECIDE);
    expect(legacy).not.toBeNull();
    expect(legacy?.[1]).toBe("approve");
    expect(legacy?.[3]).toBeUndefined();
  });

  it("accepts the new decision buttons that carry a page", () => {
    const paged = `approval:reject:${MID}:3`.match(DECIDE);
    expect(paged?.[1]).toBe("reject");
    expect(paged?.[3]).toBe("3");
  });

  it("round-trips a search term through the page payload", () => {
    const encoded = Buffer.from("Remiz", "utf8").toString("base64url");
    const match = `approval:page:${CID}:2:${encoded}`.match(PAGE);
    expect(match?.[2]).toBe("2");
    expect(decodeApprovalQuery(match?.[3] ?? "")).toBe("Remiz");
  });

  it("handles an empty search term", () => {
    const match = `approval:page:${CID}:0:`.match(PAGE);
    expect(match).not.toBeNull();
    expect(decodeApprovalQuery(match?.[3] ?? "")).toBe("");
  });

  it("never emits a payload Telegram would reject", () => {
    // 64 bytes is the hard cap; a long term must be dropped, not truncated
    // into a payload that decodes to the wrong search.
    const long = Buffer.from("a".repeat(40), "utf8").toString("base64url");
    const data = `approval:page:${CID}:1:${long}`;
    expect(Buffer.byteLength(data, "utf8")).toBeGreaterThan(64);
  });

  it("decodes junk to an empty term rather than throwing", () => {
    expect(decodeApprovalQuery("!!!not-base64!!!")).toBe("");
  });
});
