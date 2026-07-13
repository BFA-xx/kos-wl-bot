import { describe, expect, it } from "vitest";
import {
  extractHistoricalXHandles,
  groupHistoricalRaffles,
  isImportableHistoricalRaffle,
  type HistoricalRaffle,
} from "./collab-history";

const raffle = (
  id: number,
  projectName: string,
  title: string,
  taskUrl?: string,
): HistoricalRaffle => ({
  id,
  projectName,
  title,
  status: "ENDED",
  spots: title.toLowerCase().includes("fcfs") ? 7 : 3,
  entryCount: 20,
  startAt: new Date("2026-07-01T00:00:00Z"),
  endAt: new Date("2026-07-02T00:00:00Z"),
  requirements: taskUrl ? { tasks: [{ label: "Follow", url: taskUrl }] } : null,
});

describe("historical Collab Hub import", () => {
  it("groups GTD and FCFS raffles for the same project", () => {
    const groups = groupHistoricalRaffles([
      raffle(1, "VOLTOADS", "KOS X VOLTOADS GTD"),
      raffle(2, "VOLTOADS", "KOS X VOLTOADS FCFS"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      raffleIds: [1, 2],
      variants: ["GTD", "FCFS"],
      whitelistAllocation: 10,
    });
  });

  it("uses a shared X identity to join punctuation and naming variants", () => {
    const groups = groupHistoricalRaffles([
      raffle(
        3,
        "JEETErS",
        "GTD Spots",
        "https://twitter.com/intent/follow?screen_name=0xjeeters_",
      ),
      raffle(4, "JEETErS?", "FCFS Spots", "https://x.com/0xjeeters_ "),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.xUrl).toBe("https://x.com/0xjeeters_");
  });

  it("does not let a common community handle merge unrelated projects", () => {
    const groups = groupHistoricalRaffles([
      raffle(5, "Alpha", "GTD", "https://x.com/community"),
      raffle(6, "Beta", "GTD", "https://x.com/community"),
      raffle(7, "Gamma", "GTD", "https://x.com/community"),
    ]);

    expect(groups).toHaveLength(3);
  });

  it("infers the unlabeled half of an FCFS pair as GTD", () => {
    const groups = groupHistoricalRaffles([
      raffle(8, "GomeJpeg", "10"),
      raffle(13, "GomeJpeg", "FCFS Spots"),
    ]);

    expect(groups[0]?.variants).toEqual(["GTD", "FCFS"]);
  });

  it("skips cancelled, empty, and test raffles", () => {
    expect(
      isImportableHistoricalRaffle({
        ...raffle(9, "Test test", "GTD"),
      }),
    ).toBe(false);
    expect(
      isImportableHistoricalRaffle({
        ...raffle(10, "Real", "GTD"),
        status: "CANCELLED",
      }),
    ).toBe(false);
    expect(
      isImportableHistoricalRaffle({
        ...raffle(11, "Real", "GTD"),
        entryCount: 0,
      }),
    ).toBe(false);
  });

  it("extracts and normalizes handles from legacy task URLs", () => {
    expect(
      extractHistoricalXHandles(
        raffle(12, "NUTSY", "FCFS", "https://x.com/NutsyNFTs/status/1 "),
      ),
    ).toEqual(["nutsynfts"]);
  });
});
