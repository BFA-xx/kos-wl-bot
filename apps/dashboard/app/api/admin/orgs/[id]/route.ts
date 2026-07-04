import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireSuperAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Suspend or resume an organization. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireSuperAdmin();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    if (action !== "suspend" && action !== "resume") {
      return NextResponse.json({ error: "action must be suspend|resume" }, { status: 400 });
    }
    const org = await prisma.organization.update({
      where: { id: params.id },
      data: { suspendedAt: action === "suspend" ? new Date() : null },
    });
    return NextResponse.json({ ok: true, suspended: Boolean(org.suspendedAt) });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * Kick (delete) an organization: removes its members/roles/invites/subscription/
 * guild-connections/audit (cascade). The Discord guild + its raffles are NOT
 * deleted — the community just loses its KOS space.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireSuperAdmin();
    await prisma.organization.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
