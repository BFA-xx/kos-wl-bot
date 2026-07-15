import { describe, expect, it } from "vitest";
import {
  buildAllTimeActivityHistory,
  collaborationBannerUrls,
  collaborationChainLabels,
  collaborationChainText,
  collaborationDescriptor,
  meaningfulPartnerCategory,
  partnerDescriptor,
} from "./collab-presentation";

describe("collaboration presentation", () => {
  it("hides generic partner labels while preserving useful categories", () => {
    expect(meaningfulPartnerCategory("Raffle partner")).toBeNull();
    expect(meaningfulPartnerCategory("Partner")).toBeNull();
    expect(meaningfulPartnerCategory("Gaming")).toBe("Gaming");
    expect(
      partnerDescriptor({ chain: "Base", category: "Raffle partner" }),
    ).toBe("Base");
  });

  it("builds activity buckets from the first record through the current month", () => {
    expect(
      buildAllTimeActivityHistory(
        [
          { createdAt: new Date("2025-12-08T12:00:00Z") },
          { createdAt: new Date("2026-02-01T12:00:00Z") },
        ],
        new Date("2026-02-14T12:00:00Z"),
      ),
    ).toEqual([
      { key: "2025-12", label: "Dec 25", value: 1 },
      { key: "2026-01", label: "Jan 26", value: 0 },
      { key: "2026-02", label: "Feb 26", value: 1 },
    ]);
  });

  it("prefers the latest ended raffle banner and keeps older fallbacks", () => {
    expect(
      collaborationBannerUrls([
        {
          raffle: {
            status: "CANCELLED",
            bannerUrl: "https://cdn.example/cancelled.png",
            endAt: "2026-07-11T21:15:00Z",
          },
        },
        {
          raffle: {
            status: "ENDED",
            bannerUrl: "https://cdn.example/older.png",
            endAt: "2026-07-01T12:00:00Z",
          },
        },
        {
          raffle: {
            status: "ENDED",
            bannerUrl: "https://cdn.example/latest.png",
            endAt: "2026-07-10T12:00:00Z",
          },
        },
      ]),
    ).toEqual([
      "https://cdn.example/latest.png",
      "https://cdn.example/older.png",
      "https://cdn.example/cancelled.png",
    ]);
  });

  it("derives and deduplicates chains from every hosted raffle", () => {
    const raffles = [
      { raffle: { walletChains: ["ROBINHOOD", "ETHEREUM"] } },
      { raffle: { walletChains: ["BASE", "ROBINHOOD"] } },
      { raffle: { walletChains: [] } },
    ];

    expect(collaborationChainLabels(raffles, "Legacy chain")).toEqual([
      "Ethereum",
      "Base",
      "Robinhood Chain (RH)",
    ]);
    expect(collaborationChainText(raffles, "Legacy chain")).toBe(
      "Ethereum, Base, Robinhood Chain (RH)",
    );
    expect(
      collaborationDescriptor(raffles, {
        chain: "Legacy chain",
        category: "Gaming",
      }),
    ).toBe("Ethereum, Base, Robinhood Chain (RH) · Gaming");
  });

  it("uses the partner chain only when linked raffles have no chain data", () => {
    expect(
      collaborationChainText([{ raffle: { walletChains: [] } }], "ROBINHOOD"),
    ).toBe("Robinhood Chain (RH)");
    expect(collaborationChainText([], null)).toBe("");
  });
});
