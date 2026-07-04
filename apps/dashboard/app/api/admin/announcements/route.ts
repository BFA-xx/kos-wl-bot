import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireSuperAdmin } from "@/lib/access";
import type { AnnouncementLevel } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LEVELS = ["INFO", "WARNING", "CRITICAL"];

export async function POST(req: Request) {
  try {
    await requireSuperAdmin();
    const body = await req.json().catch(() => ({}));
    const title = String(body.title ?? "").trim();
    const text = String(body.body ?? "").trim();
    if (!title || !text) return NextResponse.json({ error: "Title and body required." }, { status: 400 });
    const level = (LEVELS.includes(body.level) ? body.level : "INFO") as AnnouncementLevel;
    const organizationId = body.organizationId ? String(body.organizationId) : null;

    const a = await prisma.announcement.create({
      data: { title, body: text, level, active: true, organizationId },
    });
    return NextResponse.json({ ok: true, announcement: a });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireSuperAdmin();
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await prisma.announcement.delete({ where: { id } }).catch(() => null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
