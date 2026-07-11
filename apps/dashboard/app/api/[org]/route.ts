import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, logAudit } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { normalizeXHandle } from "@/lib/organization-social";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Update org branding and public social profile. Slug is immutable. */
export async function PATCH(
  req: Request,
  { params }: { params: { org: string } },
) {
  try {
    const { org, user } = await requireOrgAccess(
      params.org,
      PERMISSIONS.BRANDING_EDIT,
    );
    const body = await req.json().catch(() => ({}));

    const data: Record<string, string | null> = {};
    if (typeof body.name === "string" && body.name.trim())
      data.name = body.name.trim();
    if ("logoUrl" in body)
      data.logoUrl = body.logoUrl ? String(body.logoUrl) : null;
    if ("bannerUrl" in body)
      data.bannerUrl = body.bannerUrl ? String(body.bannerUrl) : null;
    if ("description" in body)
      data.description = body.description ? String(body.description) : null;
    if ("xHandle" in body) {
      const raw = typeof body.xHandle === "string" ? body.xHandle.trim() : "";
      const xHandle = normalizeXHandle(raw);
      if (raw && !xHandle) {
        return NextResponse.json(
          { error: "Enter a valid X handle or x.com profile URL." },
          { status: 400 },
        );
      }
      data.xHandle = xHandle;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "Nothing to update." },
        { status: 400 },
      );
    }

    const updated = await prisma.organization.update({
      where: { id: org.id },
      data,
    });
    await logAudit(org.id, user.id, "ORG_BRANDING_UPDATE", {
      targetType: "organization",
      targetId: org.id,
    });
    return NextResponse.json({
      org: {
        slug: updated.slug,
        name: updated.name,
        logoUrl: updated.logoUrl,
        xHandle: updated.xHandle,
      },
    });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
