import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, checkPassword } from "@/lib/auth";
import { signSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const password = String(body.password ?? "");

  if (!checkPassword(password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  const secret = process.env.DASHBOARD_SESSION_TOKEN;
  if (!secret) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 500 });
  }

  const jwt = await signSession({ sub: "local-admin", name: "Admin" }, secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
