import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { FullConfig } from "@playwright/test";

function signedSession(userId: string, secret: string): string {
  const payload = {
    sub: userId,
    name: "KOS visual test",
    exp: Date.now() + 30 * 60 * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

function hasUsableSessionState(statePath: string): boolean {
  if (!existsSync(statePath)) return false;
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8")) as {
      cookies?: { name?: string; expires?: number }[];
    };
    const session = state.cookies?.find(
      (cookie) => cookie.name === "kos_session",
    );
    if (!session) return false;
    return (
      session.expires === undefined ||
      session.expires === -1 ||
      session.expires > Math.floor(Date.now() / 1000) + 60
    );
  } catch {
    return false;
  }
}

export default async function globalSetup(config: FullConfig) {
  const statePath = resolve(
    process.env.KOS_E2E_STORAGE_STATE || ".playwright/auth-state.json",
  );
  if (hasUsableSessionState(statePath)) return;

  const baseURL = config.projects[0]?.use.baseURL;
  if (typeof baseURL !== "string") {
    throw new Error("Playwright baseURL is required.");
  }

  const url = new URL(baseURL);
  const suppliedCookie = process.env.KOS_E2E_SESSION_COOKIE;
  const secret = process.env.DASHBOARD_SESSION_TOKEN;
  const userId = process.env.KOS_E2E_USER_ID;
  const cookie =
    suppliedCookie || (secret && userId ? signedSession(userId, secret) : null);
  if (!cookie) {
    throw new Error(
      "Authenticated E2E requires KOS_E2E_SESSION_COOKIE or both DASHBOARD_SESSION_TOKEN and KOS_E2E_USER_ID.",
    );
  }

  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify({
      cookies: [
        {
          name: "kos_session",
          value: cookie,
          domain: url.hostname,
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 30 * 60,
          httpOnly: true,
          secure: url.protocol === "https:",
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
    { mode: 0o600 },
  );
}
