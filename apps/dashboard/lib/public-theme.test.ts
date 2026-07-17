import { describe, expect, it } from "vitest";
import { activatePublicDarkTheme } from "./public-theme";

describe("public raffle theme bridge", () => {
  it("keeps the document dark across a client navigation", () => {
    const classes = new Set<string>();
    activatePublicDarkTheme({
      classList: { add: (value) => classes.add(value) },
    });
    expect(classes.has("dark")).toBe(true);
  });
});
