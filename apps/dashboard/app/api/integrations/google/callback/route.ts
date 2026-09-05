import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import {
  GoogleError,
  exchangeGoogleCode,
  googleOAuthConfig,
} from "@/lib/google";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Google OAuth callback. Deliberately org-agnostic: Google matches the
 * redirect URI exactly, so every org shares this one route and the target org
 * comes from the state cookie set at /api/<org>/integrations/google/start.
 */
export async function GET(req: NextRequest) {
  const cookie = req.cookies.get("kos_google_state")?.value ?? "";
  const separator = cookie.lastIndexOf(":");
  const orgSlug = separator > 0 ? cookie.slice(0, separator) : "";
  const nonce = separator > 0 ? cookie.slice(separator + 1) : "";

  const done = (slug: string, status: string) => {
    const url = new URL(slug ? `/${slug}/settings` : "/", req.url);
    url.searchParams.set("google", status);
    const res = NextResponse.redirect(url);
    res.cookies.set("kos_google_state", "", { path: "/", maxAge: 0 });
    return res;
  };

  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  if (req.nextUrl.searchParams.get("error")) return done(orgSlug, "cancelled");
  if (!orgSlug || !nonce || !state || state !== nonce) {
    return done(orgSlug, "invalid_state");
  }
  if (!code) return done(orgSlug, "no_code");

  let context;
  try {
    context = await requireOrgAccess(orgSlug, PERMISSIONS.SETTINGS_EDIT);
  } catch (err) {
    if (err instanceof AccessError) return done(orgSlug, "forbidden");
    throw err;
  }

  const base = process.env.DASHBOARD_URL || req.nextUrl.origin;
  const config = googleOAuthConfig(base);
  if (!config) return done(orgSlug, "not_configured");

  let exchanged;
  try {
    exchanged = await exchangeGoogleCode(config, code);
  } catch (err) {
    return done(
      orgSlug,
      err instanceof GoogleError ? "exchange_failed" : "error",
    );
  }

  const fields = {
    googleUserId: exchanged.googleUserId,
    googleEmail: exchanged.googleEmail,
    refreshToken: encryptSecret(exchanged.refreshToken),
    scope: exchanged.scope,
    connectedById: context.user.id,
  };
  await prisma.googleConnection.upsert({
    where: { organizationId: context.org.id },
    create: { organizationId: context.org.id, ...fields },
    update: fields,
  });
  await logAudit(context.org.id, context.user.id, "google.connected", {
    targetType: "google_connection",
    targetId: exchanged.googleUserId,
    metadata: { email: exchanged.googleEmail },
  });

  return done(orgSlug, "connected");
}
