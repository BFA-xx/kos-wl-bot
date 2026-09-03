import { NextResponse } from "next/server";
import { AccessError, requireSuperAdmin } from "@/lib/access";
import { unlinkIdentityX } from "@/lib/telegram/x-link-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Release a Telegram member's X link so they can authorize a different account. */
export async function DELETE(
  _req: Request,
  { params }: { params: { identityId: string } },
) {
  try {
    const { user } = await requireSuperAdmin();
    const result = await unlinkIdentityX(params.identityId, user.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 404 });
    }
    return NextResponse.json({ ok: true, xHandle: result.xHandle });
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
