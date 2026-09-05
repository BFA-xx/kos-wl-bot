import { NextResponse, type NextRequest } from "next/server";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { googleConsentUrl, googleOAuthConfig } from "@/lib/google";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Send an admin to Google's consent screen. The org slug rides in the state
 * cookie rather than the redirect URI, because Google only accepts redirect
 * URIs registered up front and one org-agnostic callback keeps that list to a
 * single entry.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { org: string } },
) {
  const settings = new URL(`/${params.org}/settings`, req.url);
  const fail = (reason: string) => {
    settings.searchParams.set("google", reason);
    return NextResponse.redirect(settings);
  };

  try {
    await requireOrgAccess(params.org, PERMISSIONS.SETTINGS_EDIT);
  } catch (err) {
    if (err instanceof AccessError) {
      return err.status === 401
        ? NextResponse.redirect(new URL("/login", req.url))
        : fail("forbidden");
    }
    throw err;
  }

  const base = process.env.DASHBOARD_URL || req.nextUrl.origin;
  const config = googleOAuthConfig(base);
  if (!config) return fail("not_configured");

  const nonce = crypto.randomUUID();
  const res = NextResponse.redirect(googleConsentUrl(config, nonce));
  res.cookies.set("kos_google_state", `${params.org}:${nonce}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
