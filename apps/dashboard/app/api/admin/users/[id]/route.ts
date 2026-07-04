import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireSuperAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Grant or revoke KOS super-admin for a user. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requireSuperAdmin();
    const body = await req.json().catch(() => ({}));
    const makeAdmin = Boolean(body.isSuperAdmin);

    if (params.id === user.id && !makeAdmin) {
      return NextResponse.json(
        { error: "You can't revoke your own super-admin." },
        { status: 400 },
      );
    }

    // Ensure the user row exists (they may not have logged in yet).
    await prisma.user.upsert({
      where: { id: params.id },
      create: { id: params.id, username: `user-${params.id.slice(-4)}`, isSuperAdmin: makeAdmin },
      update: { isSuperAdmin: makeAdmin },
    });
    return NextResponse.json({ ok: true, isSuperAdmin: makeAdmin });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
