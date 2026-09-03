import { NextResponse } from "next/server";
import { AccessError, requireUser } from "@/lib/access";
import { getKosMemberSummary } from "@/lib/kos/member";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The signed-in member's KOS standing — the same identity-keyed points,
 * referrals and community access KOS Bot shows in Telegram.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const summary = await getKosMemberSummary(user.id);
    if (!summary) return NextResponse.json({ linked: false });
    return NextResponse.json({ linked: true, ...summary });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("me kos summary failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
