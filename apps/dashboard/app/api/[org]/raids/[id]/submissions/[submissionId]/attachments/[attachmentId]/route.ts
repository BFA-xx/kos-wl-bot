import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: {
      org: string;
      id: string;
      submissionId: string;
      attachmentId: string;
    };
  },
) {
  try {
    const { org } = await requireOrgAccess(params.org, PERMISSIONS.RAID_VIEW);
    const attachment = await prisma.raidSubmissionAttachment.findFirst({
      where: {
        id: params.attachmentId,
        submissionId: params.submissionId,
        submission: {
          raidId: params.id,
          raid: { organizationId: org.id },
        },
      },
      select: {
        fileName: true,
        contentType: true,
        byteLength: true,
        data: true,
      },
    });
    if (!attachment) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(attachment.data), {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `inline; filename="${safeFileName(attachment.fileName)}"`,
        "content-length": String(attachment.byteLength),
        "content-type": attachment.contentType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("raid attachment read failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function safeFileName(value: string): string {
  return value.replace(/["\\\r\n]/gu, "_").slice(0, 180) || "proof";
}
