import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { googleOAuthConfig, grantsDriveAccess } from "@/lib/google";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_EDITORS = 30;

/** Connection status plus the Google accounts allowed to edit the sheets. */
export async function GET(
  req: NextRequest,
  { params }: { params: { org: string } },
) {
  try {
    const { org } = await requireOrgAccess(params.org);
    const connection = await prisma.googleConnection.findUnique({
      where: { organizationId: org.id },
      select: {
        googleEmail: true,
        editorEmails: true,
        scope: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return NextResponse.json({
      configured: Boolean(googleOAuthConfig(req.nextUrl.origin)),
      connection: connection
        ? {
            email: connection.googleEmail,
            editorEmails: connection.editorEmails,
            hasDriveAccess: grantsDriveAccess(connection.scope),
            connectedAt: connection.updatedAt.toISOString(),
          }
        : null,
    });
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** Replace the editor list. Everyone else opening a sheet link gets view-only. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { org: string } },
) {
  try {
    const { org, user } = await requireOrgAccess(
      params.org,
      PERMISSIONS.SETTINGS_EDIT,
    );
    const body = (await req.json().catch(() => ({}))) as {
      editorEmails?: unknown;
    };
    if (!Array.isArray(body.editorEmails)) {
      return NextResponse.json(
        { error: "editorEmails must be a list." },
        { status: 400 },
      );
    }

    const seen = new Set<string>();
    const editorEmails: string[] = [];
    for (const value of body.editorEmails) {
      if (typeof value !== "string") continue;
      const email = value.trim().toLowerCase();
      if (!email) continue;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
        return NextResponse.json(
          { error: `"${value}" is not a valid email address.` },
          { status: 400 },
        );
      }
      if (seen.has(email)) continue;
      seen.add(email);
      editorEmails.push(email);
    }
    if (editorEmails.length > MAX_EDITORS) {
      return NextResponse.json(
        { error: `At most ${MAX_EDITORS} editors.` },
        { status: 400 },
      );
    }

    const updated = await prisma.googleConnection.updateMany({
      where: { organizationId: org.id },
      data: { editorEmails },
    });
    if (updated.count === 0) {
      return NextResponse.json(
        { error: "Connect a Google account first." },
        { status: 409 },
      );
    }
    await logAudit(org.id, user.id, "google.editors_updated", {
      targetType: "google_connection",
      metadata: { count: editorEmails.length },
    });
    return NextResponse.json({ editorEmails });
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * Disconnect. Sheets already created stay in the connected account's Drive and
 * keep working — this only stops the dashboard creating or rewriting more, so
 * the rows recording them are dropped along with the connection.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { org: string } },
) {
  try {
    const { org, user } = await requireOrgAccess(
      params.org,
      PERMISSIONS.SETTINGS_EDIT,
    );
    await prisma.googleConnection.deleteMany({
      where: { organizationId: org.id },
    });
    await logAudit(org.id, user.id, "google.disconnected", {
      targetType: "google_connection",
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
