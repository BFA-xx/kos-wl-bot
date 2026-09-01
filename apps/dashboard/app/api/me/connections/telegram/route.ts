import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireUser } from "@/lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE() {
  try {
    const user = await requireUser();
    await prisma.connectedAccount
      .delete({
        where: {
          userId_provider: { userId: user.id, provider: "TELEGRAM" },
        },
      })
      .catch(() => null);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
