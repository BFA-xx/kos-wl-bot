import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

describe("dashboard middleware integration boundaries", () => {
  beforeEach(() => {
    process.env.DASHBOARD_SESSION_TOKEN = "session-test-secret";
  });

  it("passes the Discord member feed to its bearer-token route", async () => {
    const response = await middleware(
      new NextRequest(
        "https://raffle.koslabs.app/api/kos/integrations/discord-members",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("keeps unrelated APIs behind dashboard session auth", async () => {
    const response = await middleware(
      new NextRequest("https://raffle.koslabs.app/api/kos/overview"),
    );

    expect(response.status).toBe(401);
  });
});
