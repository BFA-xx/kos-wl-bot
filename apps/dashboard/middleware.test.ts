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

  // A Telegram member opens these in Telegram's in-app browser, which has no
  // kos_session cookie. When the middleware gated them, Connect X answered
  // {"error":"unauthorized"} for every member who had not previously signed
  // into the dashboard in that same browser — "some users, not all".
  it.each([
    ["/api/connect/x/telegram/start?t=tok", "signed single-use link token"],
    ["/api/connect/x/callback?code=c&state=s", "OAuth state cookie + PKCE"],
    ["/connect/x/telegram?x=linked", "status-only result page"],
  ])("lets the Telegram X link flow through: %s", async (path) => {
    const response = await middleware(
      new NextRequest(`https://raffle.koslabs.app${path}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("still gates the website's own X connect start", async () => {
    // Only the Telegram entry point is self-authorizing; /api/connect/x/start
    // identifies the user from their session and must stay behind it.
    const response = await middleware(
      new NextRequest("https://raffle.koslabs.app/api/connect/x/start"),
    );

    expect(response.status).toBe(401);
  });

  it("keeps unrelated APIs behind dashboard session auth", async () => {
    const response = await middleware(
      new NextRequest("https://raffle.koslabs.app/api/kos/overview"),
    );

    expect(response.status).toBe(401);
  });

  it("passes the Telegram webhook to its secret-checked route", async () => {
    const response = await middleware(
      new NextRequest(
        "https://raffle.koslabs.app/api/integrations/telegram/webhook",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
