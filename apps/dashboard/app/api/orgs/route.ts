import { NextResponse } from "next/server";
import { AccessError, requireUser, logAudit } from "@/lib/access";
import { createOrganizationWithDefaults, isValidSlug, slugAvailable, slugify } from "@/lib/orgs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Create a new organization owned by the signed-in user. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "").trim();
    const slug = slugify(String(body.slug || name));
    const logoUrl = body.logoUrl ? String(body.logoUrl) : null;

    if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });
    if (!isValidSlug(slug)) {
      return NextResponse.json(
        { error: "Handle must be 2–32 chars: lowercase letters, numbers, dashes." },
        { status: 400 },
      );
    }
    if (!(await slugAvailable(slug))) {
      return NextResponse.json({ error: "That handle is taken." }, { status: 409 });
    }

    const org = await createOrganizationWithDefaults({
      slug,
      name,
      ownerId: user.id,
      logoUrl,
    });
    await logAudit(org.id, user.id, "ORG_CREATE", { targetType: "organization", targetId: org.id });

    return NextResponse.json({ slug: org.slug, id: org.id });
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("org create failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
