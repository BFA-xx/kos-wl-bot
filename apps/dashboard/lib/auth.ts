import { cookies } from "next/headers";

export const SESSION_COOKIE = "kos_session";

/**
 * The dashboard uses a simple shared-secret session model:
 *  - DASHBOARD_PASSWORD: what an operator types on the login page.
 *  - DASHBOARD_SESSION_TOKEN: an opaque long random value stored in the cookie
 *    and compared on every request.
 *
 * For multi-user / audited access, swap this for Discord OAuth (see docs).
 */
export function expectedToken(): string | undefined {
  return process.env.DASHBOARD_SESSION_TOKEN;
}

export function isAuthed(): boolean {
  const token = expectedToken();
  if (!token) return true; // auth disabled (e.g. behind a VPN) — see docs
  return cookies().get(SESSION_COOKIE)?.value === token;
}

export function checkPassword(password: string): boolean {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return false;
  return password === expected;
}
