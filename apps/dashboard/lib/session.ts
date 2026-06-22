/**
 * Isomorphic signed-session helper (HMAC-SHA256 via Web Crypto).
 *
 * Works in both the Node route handlers (sign) and the Edge middleware
 * (verify), so the dashboard can gate every request without a session store.
 * The signing secret is DASHBOARD_SESSION_TOKEN (a random hex string).
 */
const encoder = new TextEncoder();

export interface SessionPayload {
  sub: string; // user id or "local-admin"
  name?: string;
  exp: number; // epoch ms
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input: string): Uint8Array {
  let str = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = str.length % 4 ? 4 - (str.length % 4) : 0;
  str += "=".repeat(pad);
  const bin = atob(str);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return new Uint8Array(sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function signSession(
  payload: Omit<SessionPayload, "exp">,
  secret: string,
  ttlMs = DEFAULT_TTL_MS,
): Promise<string> {
  const body = b64url(
    encoder.encode(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })),
  );
  const sig = b64url(await hmac(secret, body));
  return `${body}.${sig}`;
}

export async function verifySession(
  token: string | undefined,
  secret: string,
): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = b64url(await hmac(secret, body));
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(
      new TextDecoder().decode(b64urlDecode(body)),
    ) as SessionPayload;
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
