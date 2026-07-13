import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrgAccess, withAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { syncCollaborationState } from "@/lib/collab";

export const dynamic = "force-dynamic";

async function context(orgSlug: string, id: string) {
  const access = await requireOrgAccess(orgSlug, PERMISSIONS.COLLAB_EDIT);
  const collaboration = await prisma.collaboration.findFirst({
    where: { id, organizationId: access.org.id },
    select: { id: true, projectName: true },
  });
  return { access, collaboration };
}

export const POST = withAccess(async (req, { params }) => {
  const { access, collaboration } = await context(params.org, params.id);
  if (!collaboration)
    return NextResponse.json(
      { error: "Collaboration not found." },
      { status: 404 },
    );
  const body = await req.json().catch(() => ({}));
  const raffleId = Number(body.raffleId);
  if (!Number.isSafeInteger(raffleId) || raffleId < 1) {
    return NextResponse.json(
      { error: "Pick a valid raffle." },
      { status: 400 },
    );
  }
  const raffle = await prisma.raffle.findFirst({
    where: { id: raffleId, guildId: { in: access.guildIds } },
    select: { id: true, projectName: true },
  });
  if (!raffle)
    return NextResponse.json({ error: "Raffle not found." }, { status: 404 });
  const claimed = await prisma.collaborationRaffle.findUnique({
    where: { raffleId },
  });
  if (claimed) {
    return NextResponse.json(
      { error: "That raffle is already attached to a collaboration." },
      { status: 409 },
    );
  }
  await prisma.$transaction([
    prisma.collaborationRaffle.create({
      data: {
        collaborationId: collaboration.id,
        raffleId,
        attachedById: access.user.id,
      },
    }),
    prisma.collaboration.update({
      where: { id: collaboration.id },
      data: { status: "HOSTING", lastActivityAt: new Date() },
    }),
    prisma.collaborationActivity.create({
      data: {
        collaborationId: collaboration.id,
        actorId: access.user.id,
        action: "RAFFLE_ATTACHED",
        title: `Raffle #${raffle.id} attached`,
        body: raffle.projectName,
        metadata: { raffleId: raffle.id },
      },
    }),
  ]);
  await syncCollaborationState(collaboration.id, access.org.id);
  return NextResponse.json({ ok: true });
});

export const DELETE = withAccess(async (req, { params }) => {
  const { collaboration } = await context(params.org, params.id);
  if (!collaboration)
    return NextResponse.json(
      { error: "Collaboration not found." },
      { status: 404 },
    );
  const body = await req.json().catch(() => ({}));
  const raffleId = Number(body.raffleId);
  const result = await prisma.collaborationRaffle.deleteMany({
    where: { collaborationId: collaboration.id, raffleId },
  });
  if (!result.count)
    return NextResponse.json(
      { error: "Raffle link not found." },
      { status: 404 },
    );
  return NextResponse.json({ ok: true });
});
