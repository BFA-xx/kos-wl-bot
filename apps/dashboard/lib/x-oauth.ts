import { createHash, randomBytes } from "node:crypto";

/**
 * X (Twitter) OAuth 2.0 helpers — Authorization Code + PKCE.
 *
 * Linking an X account proves ownership and gives KOS the user's real handle;
 * every org can then run X tasks against that verified identity. Verification
 * depth is tier-aware (X_API_TIER): "free" = link + attest (no paid API);
 * higher tiers can add real follow/like checks later without a rebuild.
 */

export const X_SCOPES = ["users.read", "tweet.read", "follows.read", "offline.access"];

export function xConfigured(): boolean {
  return Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET);
}

export function xApiTier(): string {
  return process.env.X_API_TIER ?? "free";
}

const b64url = (b: Buffer) =>
  b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** PKCE pair: high-entropy verifier + S256 challenge. */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function buildXAuthUrl(redirectUri: string, state: string, challenge: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.X_CLIENT_ID!,
    redirect_uri: redirectUri,
    scope: X_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `https://x.com/i/oauth2/authorize?${params.toString()}`;
}

export interface XTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

async function tokenRequest(fields: Record<string, string>): Promise<XTokenResponse | null> {
  const basic = Buffer.from(
    `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`,
  ).toString("base64");
  const res = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams(fields),
  });
  if (!res.ok) return null;
  return (await res.json()) as XTokenResponse;
}

export async function exchangeXCode(
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<XTokenResponse | null> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    client_id: process.env.X_CLIENT_ID!,
  });
}

export async function refreshXToken(refreshToken: string): Promise<XTokenResponse | null> {
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: process.env.X_CLIENT_ID!,
  });
}

export interface XUser {
  id: string;
  username: string;
  name: string;
  profile_image_url?: string;
}

export async function fetchXMe(accessToken: string): Promise<XUser | null> {
  const res = await fetch(
    "https://api.x.com/2/users/me?user.fields=profile_image_url",
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: XUser };
  return body.data ?? null;
}
