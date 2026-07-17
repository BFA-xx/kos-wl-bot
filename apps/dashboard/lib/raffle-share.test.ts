import { describe, expect, it } from "vitest";
import {
  DEFAULT_PUBLIC_RAFFLE_ORIGIN,
  PUBLIC_RAFFLE_ORIGIN,
  PUBLIC_RAFFLE_STATUSES,
  canonicalRaffleBannerUrl,
  normalizePublicRaffleOrigin,
  parsePublicRaffleId,
  parsePublicRaffleReference,
  publicRafflePath,
  publicRaffleReference,
  publicRaffleUrl,
  titleForDuplicateVariant,
} from "./raffle-share";

describe("public raffle policy", () => {
  it("publishes only the explicit public lifecycle states", () => {
    expect(PUBLIC_RAFFLE_STATUSES).toEqual(["UPCOMING", "LIVE", "ENDED"]);
    expect(PUBLIC_RAFFLE_STATUSES).not.toContain("DRAFT");
    expect(PUBLIC_RAFFLE_STATUSES).not.toContain("CANCELLED");
  });

  it("accepts only global positive PostgreSQL Int ids", () => {
    expect(parsePublicRaffleId("57")).toBe(57);
    expect(parsePublicRaffleId("57x")).toBeNull();
    expect(parsePublicRaffleId("0")).toBeNull();
    expect(parsePublicRaffleId("2147483648")).toBeNull();
  });

  it("builds branded collision-safe raffle references", () => {
    const raffle = {
      raffleId: 57,
      organizationSlug: "KOS Community",
      projectName: "Dorian Pepentice",
    };
    expect(publicRaffleReference(raffle)).toBe(
      "kos-community-x-dorian-pepentice-57",
    );
    expect(publicRafflePath(raffle)).toBe(
      "/r/kos-community-x-dorian-pepentice-57",
    );
    expect(publicRaffleUrl(raffle)).toBe(
      `${PUBLIC_RAFFLE_ORIGIN}/r/kos-community-x-dorian-pepentice-57`,
    );
    expect(parsePublicRaffleReference("57")).toBe(57);
    expect(
      parsePublicRaffleReference("kos-community-x-dorian-pepentice-57"),
    ).toBe(57);
    expect(parsePublicRaffleReference("kos-x-raffle")).toBeNull();
  });

  it("normalizes configured origins and rejects unsafe protocols", () => {
    expect(normalizePublicRaffleOrigin("https://example.com/path/")).toBe(
      "https://example.com",
    );
    expect(normalizePublicRaffleOrigin("javascript:alert(1)")).toBe(
      DEFAULT_PUBLIC_RAFFLE_ORIGIN,
    );
    expect(normalizePublicRaffleOrigin("not a url")).toBe(
      DEFAULT_PUBLIC_RAFFLE_ORIGIN,
    );
  });

  it("moves durable banner routes off retired deployment hostnames", () => {
    expect(
      canonicalRaffleBannerUrl(
        65,
        "https://retired.vercel.app/r/65/banner?v=123",
      ),
    ).toBe(`${PUBLIC_RAFFLE_ORIGIN}/r/65/banner?v=123`);
    expect(canonicalRaffleBannerUrl(65, "https://cdn.example/banner.png")).toBe(
      "https://cdn.example/banner.png",
    );
    expect(canonicalRaffleBannerUrl(65, "javascript:alert(1)")).toBeNull();
  });

  it("switches recurring raffle variants without changing other title text", () => {
    expect(titleForDuplicateVariant("Partner GTD spots", "FCFS")).toBe(
      "Partner FCFS spots",
    );
    expect(titleForDuplicateVariant("Partner allowlist", "GTD")).toBe(
      "GTD Partner allowlist",
    );
  });
});
