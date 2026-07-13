import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrgAccess, withAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { sanitizeHttpUrl } from "@/lib/raffle-input";
import { toOptionalDate } from "@/lib/collab-shared";
import { richTextToPlainText, sanitizeRichText } from "@/lib/rich-text";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const text = (value: unknown, max = 500) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

async function resolve(
  orgSlug: string,
  id: string,
  permission = PERMISSIONS.COLLAB_EDIT,
) {
  const access = await requireOrgAccess(orgSlug, permission);
  const collaboration = await prisma.collaboration.findFirst({
    where: { id, organizationId: access.org.id },
    select: { id: true, partnerId: true, projectName: true },
  });
  return { access, collaboration };
}

export const POST = withAccess(async (req, { params }) => {
  const { access, collaboration } = await resolve(params.org, params.id);
  if (!collaboration) {
    return NextResponse.json(
      { error: "Collaboration not found." },
      { status: 404 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const kind = text(body.kind, 20).toLowerCase();
  let item: unknown;
  if (kind === "note") {
    const value = sanitizeRichText(body.body);
    if (!richTextToPlainText(value))
      return NextResponse.json(
        { error: "Write a note first." },
        { status: 400 },
      );
    item = await prisma.collaborationNote.create({
      data: {
        collaborationId: collaboration.id,
        authorId: access.user.id,
        body: value,
        pinned: Boolean(body.pinned),
      },
    });
  } else if (kind === "comment") {
    const value = text(body.body, 10_000);
    if (!value)
      return NextResponse.json(
        { error: "Write a comment first." },
        { status: 400 },
      );
    const candidates = [...value.matchAll(/<?@(\d{5,25})>?/g)].map(
      (match) => match[1]!,
    );
    const team = candidates.length
      ? await prisma.organizationMember.findMany({
          where: {
            organizationId: access.org.id,
            userId: { in: [...new Set(candidates)] },
            status: "ACTIVE",
          },
          select: { userId: true },
        })
      : [];
    const mentionedUserIds = [
      ...new Set([
        ...team.map((member) => member.userId),
        ...(candidates.includes(access.org.ownerId)
          ? [access.org.ownerId]
          : []),
      ]),
    ];
    item = await prisma.collaborationComment.create({
      data: {
        collaborationId: collaboration.id,
        authorId: access.user.id,
        body: value,
        mentionedUserIds,
      },
    });
    if (mentionedUserIds.length) {
      await prisma.notification.createMany({
        data: mentionedUserIds
          .filter((userId) => userId !== access.user.id)
          .map((userId) => ({
            userId,
            type: "COLLAB_MENTION",
            title: `You were mentioned in ${collaboration.projectName}`,
            body: value.slice(0, 180),
            link: `/${params.org}/collabs/${collaboration.id}?tab=comments`,
          })),
      });
    }
  } else if (kind === "contact") {
    const name = text(body.name, 120);
    if (!name)
      return NextResponse.json(
        { error: "Contact name is required." },
        { status: 400 },
      );
    if (body.isPrimary) {
      await prisma.collaborationContact.updateMany({
        where: { collaborationId: collaboration.id },
        data: { isPrimary: false },
      });
    }
    item = await prisma.collaborationContact.create({
      data: {
        collaborationId: collaboration.id,
        partnerId: collaboration.partnerId,
        name,
        role: text(body.role, 80) || null,
        discord: text(body.discord, 120) || null,
        telegram: text(body.telegram, 120) || null,
        xUrl: sanitizeHttpUrl(body.xUrl),
        email: text(body.email, 254) || null,
        notes: text(body.notes, 5_000) || null,
        conversation: text(body.conversation, 20_000) || null,
        isPrimary: Boolean(body.isPrimary),
        createdById: access.user.id,
      },
    });
  } else if (kind === "reminder") {
    const title = text(body.title, 160);
    const dueAt = toOptionalDate(body.dueAt);
    if (!title || !dueAt) {
      return NextResponse.json(
        { error: "Reminder title and due date are required." },
        { status: 400 },
      );
    }
    const allowed = [
      "HOSTING",
      "WALLET_SUBMISSION",
      "COLLABORATION_DEADLINE",
      "FOLLOW_UP",
      "INACTIVE",
      "CUSTOM",
    ];
    item = await prisma.collaborationReminder.create({
      data: {
        collaborationId: collaboration.id,
        type: allowed.includes(body.type) ? body.type : "CUSTOM",
        title,
        dueAt,
        createdById: access.user.id,
      },
    });
  } else {
    return NextResponse.json(
      { error: "Unsupported item type." },
      { status: 400 },
    );
  }
  await prisma.$transaction([
    prisma.collaboration.update({
      where: { id: collaboration.id },
      data: { lastActivityAt: new Date() },
    }),
    prisma.collaborationActivity.create({
      data: {
        collaborationId: collaboration.id,
        actorId: access.user.id,
        action: `${kind.toUpperCase()}_ADDED`,
        title: `${kind[0]!.toUpperCase()}${kind.slice(1)} added`,
      },
    }),
  ]);
  return NextResponse.json({ item }, { status: 201 });
});

export const PATCH = withAccess(async (req, { params }) => {
  const { collaboration } = await resolve(params.org, params.id);
  if (!collaboration) {
    return NextResponse.json(
      { error: "Collaboration not found." },
      { status: 404 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const kind = text(body.kind, 20).toLowerCase();
  const itemId = text(body.itemId, 80);
  if (!itemId)
    return NextResponse.json(
      { error: "Item id is required." },
      { status: 400 },
    );
  let count = 0;
  if (kind === "note") {
    const noteBody =
      body.body !== undefined ? sanitizeRichText(body.body) : undefined;
    if (noteBody !== undefined && !richTextToPlainText(noteBody)) {
      return NextResponse.json(
        { error: "A note cannot be empty." },
        { status: 400 },
      );
    }
    const result = await prisma.collaborationNote.updateMany({
      where: { id: itemId, collaborationId: collaboration.id },
      data: {
        ...(noteBody !== undefined ? { body: noteBody } : {}),
        ...(body.pinned !== undefined ? { pinned: Boolean(body.pinned) } : {}),
      },
    });
    count = result.count;
  } else if (kind === "comment") {
    const result = await prisma.collaborationComment.updateMany({
      where: { id: itemId, collaborationId: collaboration.id },
      data: { body: text(body.body, 10_000) },
    });
    count = result.count;
  } else if (kind === "contact") {
    if (body.isPrimary) {
      await prisma.collaborationContact.updateMany({
        where: { collaborationId: collaboration.id, id: { not: itemId } },
        data: { isPrimary: false },
      });
    }
    const result = await prisma.collaborationContact.updateMany({
      where: { id: itemId, collaborationId: collaboration.id },
      data: {
        ...(body.name !== undefined ? { name: text(body.name, 120) } : {}),
        ...(body.role !== undefined
          ? { role: text(body.role, 80) || null }
          : {}),
        ...(body.discord !== undefined
          ? { discord: text(body.discord, 120) || null }
          : {}),
        ...(body.telegram !== undefined
          ? { telegram: text(body.telegram, 120) || null }
          : {}),
        ...(body.xUrl !== undefined
          ? { xUrl: sanitizeHttpUrl(body.xUrl) }
          : {}),
        ...(body.email !== undefined
          ? { email: text(body.email, 254) || null }
          : {}),
        ...(body.notes !== undefined
          ? { notes: text(body.notes, 5_000) || null }
          : {}),
        ...(body.conversation !== undefined
          ? { conversation: text(body.conversation, 20_000) || null }
          : {}),
        ...(body.isPrimary !== undefined
          ? { isPrimary: Boolean(body.isPrimary) }
          : {}),
      },
    });
    count = result.count;
  } else if (kind === "reminder") {
    const result = await prisma.collaborationReminder.updateMany({
      where: { id: itemId, collaborationId: collaboration.id },
      data: {
        ...(body.title !== undefined ? { title: text(body.title, 160) } : {}),
        ...(body.dueAt !== undefined
          ? { dueAt: toOptionalDate(body.dueAt) ?? undefined }
          : {}),
        ...(body.completed !== undefined
          ? { completedAt: body.completed ? new Date() : null }
          : {}),
      },
    });
    count = result.count;
  }
  if (!count)
    return NextResponse.json({ error: "Item not found." }, { status: 404 });
  await prisma.collaboration.update({
    where: { id: collaboration.id },
    data: { lastActivityAt: new Date() },
  });
  return NextResponse.json({ ok: true });
});

export const DELETE = withAccess(async (req, { params }) => {
  const { collaboration } = await resolve(params.org, params.id);
  if (!collaboration) {
    return NextResponse.json(
      { error: "Collaboration not found." },
      { status: 404 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const kind = text(body.kind, 20).toLowerCase();
  const itemId = text(body.itemId, 80);
  let count = 0;
  if (kind === "note") {
    count = (
      await prisma.collaborationNote.deleteMany({
        where: { id: itemId, collaborationId: collaboration.id },
      })
    ).count;
  } else if (kind === "comment") {
    count = (
      await prisma.collaborationComment.deleteMany({
        where: { id: itemId, collaborationId: collaboration.id },
      })
    ).count;
  } else if (kind === "contact") {
    count = (
      await prisma.collaborationContact.deleteMany({
        where: { id: itemId, collaborationId: collaboration.id },
      })
    ).count;
  } else if (kind === "reminder") {
    count = (
      await prisma.collaborationReminder.deleteMany({
        where: { id: itemId, collaborationId: collaboration.id },
      })
    ).count;
  }
  if (!count)
    return NextResponse.json({ error: "Item not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
});
