import { NextResponse } from "next/server";
import { requireOrgAccess, withAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { fetchXProfileMetadata } from "@/lib/x-profile-metadata";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withAccess(async (req, { params }) => {
  await requireOrgAccess(params.org, PERMISSIONS.COLLAB_VIEW);
  const input = new URL(req.url).searchParams.get("url");
  try {
    const profile = await fetchXProfileMetadata(input);
    if (!profile) {
      return NextResponse.json(
        { error: "Enter a valid public X profile URL." },
        { status: 422 },
      );
    }
    return NextResponse.json({ profile });
  } catch {
    return NextResponse.json(
      {
        error:
          "Project information is temporarily unavailable. You can keep filling the row manually.",
      },
      { status: 502 },
    );
  }
});
