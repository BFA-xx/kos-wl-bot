import { NextResponse, type NextRequest } from "next/server";
import { del, get, head } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { prisma } from "@/lib/db";
import { logAudit, requireOrgAccess, withAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX = 15 * 1024 * 1024;
const ALLOWED = new Set([
  "application/pdf",
  "text/csv",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const ALLOWED_UPLOAD_TYPES = ["image/*", ...ALLOWED];

function validType(type: string): boolean {
  return type.startsWith("image/") || ALLOWED.has(type);
}

function safeName(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/[\r\n"]/g, "")
        .trim()
        .slice(0, 200)
    : "file";
}

function pathPrefix(slug: string, id: string): string {
  return `orgs/${slug}/collaborations/${id}/`;
}

async function findCollaboration(organizationId: string, id: string) {
  return prisma.collaboration.findFirst({
    where: { id, organizationId },
    select: { id: true, projectName: true },
  });
}

/**
 * Streams a private Blob only after checking organization membership and the
 * collaboration permission. Raw Blob URLs are never returned by detail APIs.
 */
export const GET = withAccess(async (request, { params }) => {
  const req = request as NextRequest;
  const { org } = await requireOrgAccess(params.org, PERMISSIONS.COLLAB_VIEW);
  const attachment = await prisma.collaborationAttachment.findFirst({
    where: {
      id: req.nextUrl.searchParams.get("attachmentId") ?? "",
      collaborationId: params.id,
      collaboration: { organizationId: org.id },
    },
  });
  if (!attachment) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const blob = await get(attachment.url, { access: "private" });
  if (!blob || blob.statusCode !== 200) {
    return NextResponse.json(
      { error: "File is unavailable." },
      { status: 404 },
    );
  }
  const download = req.nextUrl.searchParams.get("download") === "1";
  return new Response(blob.stream, {
    headers: {
      "content-type": attachment.mimeType ?? blob.blob.contentType,
      "content-length": String(attachment.size ?? blob.blob.size),
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${safeName(attachment.name)}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});

/** Issue a short-lived, path-restricted token for a direct 15 MB client upload. */
export const POST = withAccess(async (request, { params }) => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "File upload is not configured." },
      { status: 501 },
    );
  }
  const body = (await request.json()) as HandleUploadBody;
  const result = await handleUpload({
    request,
    body,
    onBeforeGenerateToken: async (pathname) => {
      const { org } = await requireOrgAccess(
        params.org,
        PERMISSIONS.COLLAB_EDIT,
      );
      const collaboration = await findCollaboration(org.id, params.id);
      if (!collaboration) throw new Error("Collaboration not found.");
      if (!pathname.startsWith(pathPrefix(org.slug, collaboration.id))) {
        throw new Error("Invalid upload path.");
      }
      return {
        allowedContentTypes: ALLOWED_UPLOAD_TYPES,
        maximumSizeInBytes: MAX,
        addRandomSuffix: true,
      };
    },
  });
  return NextResponse.json(result);
});

/** Register a completed private upload after verifying its real Blob metadata. */
export const PUT = withAccess(async (request, { params }) => {
  const { org, user } = await requireOrgAccess(
    params.org,
    PERMISSIONS.COLLAB_EDIT,
  );
  const collaboration = await findCollaboration(org.id, params.id);
  if (!collaboration) {
    return NextResponse.json(
      { error: "Collaboration not found." },
      { status: 404 },
    );
  }
  const body = await request.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return NextResponse.json(
      { error: "Upload URL is required." },
      { status: 400 },
    );
  }
  const metadata = await head(url).catch(() => null);
  if (
    !metadata ||
    !metadata.pathname.startsWith(pathPrefix(org.slug, collaboration.id))
  ) {
    return NextResponse.json(
      { error: "Invalid uploaded file." },
      { status: 400 },
    );
  }
  if (!validType(metadata.contentType)) {
    await del(url).catch(() => undefined);
    return NextResponse.json(
      { error: "This file type is not supported." },
      { status: 400 },
    );
  }
  if (metadata.size > MAX) {
    await del(url).catch(() => undefined);
    return NextResponse.json(
      { error: "Files must be 15 MB or smaller." },
      { status: 413 },
    );
  }
  const name = safeName(body.name) || "file";
  const attachment = await prisma.$transaction(async (tx) => {
    const saved = await tx.collaborationAttachment.upsert({
      where: { url },
      create: {
        collaborationId: collaboration.id,
        name,
        url,
        mimeType: metadata.contentType,
        size: metadata.size,
        kind: metadata.contentType.startsWith("image/") ? "IMAGE" : "DOCUMENT",
        uploadedById: user.id,
      },
      update: {},
    });
    if (saved.collaborationId !== collaboration.id) {
      throw new Error("Attachment belongs to another collaboration.");
    }
    await tx.collaborationActivity.create({
      data: {
        collaborationId: collaboration.id,
        actorId: user.id,
        action: "FILE_ATTACHED",
        title: `${name} attached`,
      },
    });
    await tx.collaboration.update({
      where: { id: collaboration.id },
      data: { lastActivityAt: new Date() },
    });
    return saved;
  });
  await logAudit(org.id, user.id, "COLLABORATION_FILE_ATTACHED", {
    targetType: "collaboration",
    targetId: collaboration.id,
    metadata: { attachmentId: attachment.id, size: metadata.size },
  });
  return NextResponse.json(
    {
      attachment: {
        ...attachment,
        url: undefined,
      },
    },
    { status: 201 },
  );
});

export const DELETE = withAccess(async (request, { params }) => {
  const { org, user } = await requireOrgAccess(
    params.org,
    PERMISSIONS.COLLAB_EDIT,
  );
  const body = await request.json().catch(() => ({}));
  const attachment = await prisma.collaborationAttachment.findFirst({
    where: {
      id: typeof body.attachmentId === "string" ? body.attachmentId : "",
      collaborationId: params.id,
      collaboration: { organizationId: org.id },
    },
  });
  if (!attachment) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  await prisma.$transaction([
    prisma.collaborationAttachment.delete({ where: { id: attachment.id } }),
    prisma.collaborationActivity.create({
      data: {
        collaborationId: params.id,
        actorId: user.id,
        action: "FILE_REMOVED",
        title: `${attachment.name} removed`,
      },
    }),
  ]);
  await del(attachment.url).catch(() => undefined);
  await logAudit(org.id, user.id, "COLLABORATION_FILE_REMOVED", {
    targetType: "collaboration",
    targetId: params.id,
    metadata: { attachmentId: attachment.id },
  });
  return NextResponse.json({ ok: true });
});
