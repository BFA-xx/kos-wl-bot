import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireUser } from "@/lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Unlink the signed-in user's X account. */
export async function DELETE() {
  try {
    const user = await requireUser();
    await prisma.connectedAccount
      .delete({ where: { userId_provider: { userId: user.id, provider: "X" } } })
      .catch(() => null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
