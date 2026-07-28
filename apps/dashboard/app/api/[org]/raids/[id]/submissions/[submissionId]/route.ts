import { NextResponse } from "next/server";
import { RaidStatus, RaidSubmissionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

class ParticipantLimitError extends Error {}

export async function PATCH(
  request: Request,
  { params }: { params: { org: string; id: string; submissionId: string } },
) {
  try {
    const { org, user } = await requireOrgAccess(
      params.org,
      PERMISSIONS.RAID_EDIT,
    );
    const body = (await request.json().catch(() => ({}))) as {
      status?: unknown;
    };
    const nextSubmissionStatus = String(
      body.status ?? "",
    ) as RaidSubmissionStatus;
    if (
      !(
        [
          RaidSubmissionStatus.PENDING,
          RaidSubmissionStatus.VALID,
          RaidSubmissionStatus.INVALID,
        ] as RaidSubmissionStatus[]
      ).includes(nextSubmissionStatus)
    )
      return NextResponse.json(
        { error: "Select Pending, Valid, or Invalid." },
        { status: 400 },
      );

    const submission = await prisma.raidSubmission.findFirst({
      where: {
        id: params.submissionId,
        raidId: params.id,
        raid: { organizationId: org.id },
      },
      include: {
        participant: true,
        raid: {
          select: {
            id: true,
            status: true,
            participantLimit: true,
            validParticipantCount: true,
          },
        },
      },
    });
    if (!submission)
      return NextResponse.json(
        { error: "Submission not found." },
        { status: 404 },
      );
    if (submission.raid.status === RaidStatus.CANCELLED)
      return NextResponse.json(
        { error: "Cancelled raid submissions cannot be reviewed." },
        { status: 409 },
      );
    if (
      submission.raid.status === RaidStatus.ENDED &&
      submission.participant.status === RaidSubmissionStatus.VALID &&
      nextSubmissionStatus !== RaidSubmissionStatus.VALID
    )
      return NextResponse.json(
        {
          error:
            "A rewarded participant cannot be invalidated after the raid ends.",
        },
        { status: 409 },
      );

    await prisma.$transaction(async (tx) => {
      await tx.raidSubmission.update({
        where: { id: submission.id },
        data: {
          status: nextSubmissionStatus,
          reviewedAt: new Date(),
          reviewedById: user.id,
        },
      });
      const statuses = await tx.raidSubmission.findMany({
        where: {
          participantId: submission.participantId,
          status: { not: RaidSubmissionStatus.DUPLICATE },
        },
        select: { status: true },
      });
      const nextParticipantStatus = aggregateStatus(
        statuses.map((row) => row.status),
      );
      const wasValid =
        submission.participant.status === RaidSubmissionStatus.VALID;
      const becomesValid = nextParticipantStatus === RaidSubmissionStatus.VALID;
      if (!wasValid && becomesValid) {
        const claimed = await tx.raid.updateMany({
          where: {
            id: submission.raid.id,
            ...(submission.raid.participantLimit
              ? {
                  validParticipantCount: {
                    lt: submission.raid.participantLimit,
                  },
                }
              : {}),
          },
          data: {
            validParticipantCount: { increment: 1 },
            ...(submission.raid.status === RaidStatus.ENDED
              ? { finalizedAt: null }
              : {}),
          },
        });
        if (claimed.count === 0) throw new ParticipantLimitError();
      } else if (wasValid && !becomesValid) {
        await tx.raid.update({
          where: { id: submission.raid.id },
          data: { validParticipantCount: { decrement: 1 } },
        });
      } else if (
        becomesValid &&
        submission.raid.status === RaidStatus.ENDED &&
        !submission.participant.roleAssignedAt
      ) {
        await tx.raid.update({
          where: { id: submission.raid.id },
          data: { finalizedAt: null },
        });
      }
      await tx.raidParticipant.update({
        where: { id: submission.participantId },
        data: {
          status: nextParticipantStatus,
          ...(becomesValid ? { roleAssignmentError: null } : {}),
        },
      });
    });

    await logAudit(org.id, user.id, "RAID_SUBMISSION_REVIEW", {
      targetType: "raid_submission",
      targetId: submission.id,
      metadata: {
        raidId: submission.raid.id,
        status: nextSubmissionStatus,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ParticipantLimitError)
      return NextResponse.json(
        { error: "This raid's participant limit has already been reached." },
        { status: 409 },
      );
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("raid submission review failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function aggregateStatus(
  statuses: RaidSubmissionStatus[],
): RaidSubmissionStatus {
  if (statuses.includes(RaidSubmissionStatus.VALID))
    return RaidSubmissionStatus.VALID;
  if (statuses.includes(RaidSubmissionStatus.PENDING))
    return RaidSubmissionStatus.PENDING;
  return RaidSubmissionStatus.INVALID;
}
