import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrgAccess, withAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

const text = (value: unknown, max = 120) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export const POST = withAccess(async (req, { params }) => {
  const { org, user } = await requireOrgAccess(
    params.org,
    PERMISSIONS.COLLAB_VIEW,
  );
  const body = await req.json().catch(() => ({}));
  const name = text(body.name);
  if (!name || !body.criteria || typeof body.criteria !== "object") {
    return NextResponse.json(
      { error: "Filter name and criteria are required." },
      { status: 400 },
    );
  }
  const filter = await prisma.collaborationSavedFilter.create({
    data: {
      organizationId: org.id,
      name,
      view: text(body.view, 20) || "TABLE",
      criteria: body.criteria,
      createdById: user.id,
      shared: body.shared !== false,
    },
  });
  return NextResponse.json({ filter }, { status: 201 });
});

export const DELETE = withAccess(async (req, { params }) => {
  const { org } = await requireOrgAccess(params.org, PERMISSIONS.COLLAB_EDIT);
  const body = await req.json().catch(() => ({}));
  const result = await prisma.collaborationSavedFilter.deleteMany({
    where: {
      id: typeof body.id === "string" ? body.id : "",
      organizationId: org.id,
    },
  });
  if (!result.count)
    return NextResponse.json({ error: "Filter not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
});
