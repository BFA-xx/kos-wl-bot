import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireSuperAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Create or toggle a feature flag. */
export async function POST(req: Request) {
  try {
    await requireSuperAdmin();
    const body = await req.json().catch(() => ({}));
    const key = String(body.key ?? "").trim();
    if (!key) return NextResponse.json({ error: "Key required." }, { status: 400 });
    const enabled = Boolean(body.enabled);
    const description = body.description ? String(body.description) : undefined;

    const flag = await prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled, description },
      update: { enabled, ...(description !== undefined ? { description } : {}) },
    });
    return NextResponse.json({ ok: true, flag });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
