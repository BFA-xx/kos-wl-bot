import {
  Prisma,
  VerificationAttemptStatus,
  type VerificationCode,
} from "@kos/db";
import { prisma } from "@kos/db";

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;

export class VerificationCodeError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "INVALID_FORMAT"
      | "DUPLICATE"
      | "NOT_FOUND"
      | "INACTIVE"
      | "EXPIRED"
      | "EXHAUSTED"
      | "ALREADY_REDEEMED"
      | "IN_USE",
  ) {
    super(message);
    this.name = "VerificationCodeError";
  }
}

export function normalizeVerificationCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!CODE_PATTERN.test(normalized)) {
    throw new VerificationCodeError(
      "Codes must be 1–32 characters using letters, numbers, hyphens, or underscores.",
      "INVALID_FORMAT",
    );
  }
  return normalized;
}

export function parseVerificationMaxUses(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || ["unlimited", "none", "never", "∞"].includes(normalized)) {
    return null;
  }
  const uses = Number(normalized);
  if (!Number.isSafeInteger(uses) || uses < 1 || uses > 1_000_000) {
    throw new Error(
      "Max uses must be a whole number from 1 to 1,000,000, or “unlimited”.",
    );
  }
  return uses;
}

export function parseVerificationExpiration(
  value: string,
  now = new Date(),
): Date | null {
  const normalized = value.trim();
  if (
    !normalized ||
    ["never", "none", "no expiry"].includes(normalized.toLowerCase())
  ) {
    return null;
  }
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    throw new Error(
      "Expiration must be an ISO date such as 2026-08-01T18:00:00Z, or “never”.",
    );
  }
  const expiresAt = new Date(timestamp);
  if (expiresAt <= now) {
    throw new Error("Expiration must be in the future.");
  }
  return expiresAt;
}

export function parseVerificationCodeState(value: string): {
  active: boolean;
  oneTimePerMember: boolean;
} {
  const normalized = value.trim().toLowerCase();
  const inactive =
    normalized.includes("inactive") ||
    normalized.includes("disabled") ||
    normalized === "off" ||
    normalized.startsWith("off,") ||
    normalized.includes(", off");
  const reusable =
    normalized.includes("reusable") ||
    normalized.includes("repeat") ||
    normalized.includes("multiple per member");
  return {
    active: !inactive,
    oneTimePerMember: !reusable,
  };
}

interface SaveCodeInput {
  guildId: string;
  code: string;
  description?: string | null;
  roleIds?: string[];
  maxUses?: number | null;
  expiresAt?: Date | null;
  active?: boolean;
  oneTimePerMember?: boolean;
  actorId: string;
}

export async function createVerificationCode(
  input: SaveCodeInput,
): Promise<VerificationCode> {
  const code = normalizeVerificationCode(input.code);
  try {
    return await prisma.verificationCode.create({
      data: {
        guildId: input.guildId,
        code,
        description: cleanDescription(input.description),
        roleIds: uniqueIds(input.roleIds ?? []),
        maxUses: input.maxUses ?? null,
        expiresAt: input.expiresAt ?? null,
        active: input.active ?? true,
        oneTimePerMember: input.oneTimePerMember ?? true,
        createdById: input.actorId,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new VerificationCodeError(
        `Code ${code} already exists in this server.`,
        "DUPLICATE",
      );
    }
    throw error;
  }
}

export async function updateVerificationCode(
  id: string,
  input: Omit<SaveCodeInput, "guildId" | "actorId" | "roleIds"> & {
    guildId: string;
  },
): Promise<VerificationCode> {
  const existing = await prisma.verificationCode.findFirst({
    where: { id, guildId: input.guildId },
  });
  if (!existing) {
    throw new VerificationCodeError(
      "Verification code not found.",
      "NOT_FOUND",
    );
  }
  const code = normalizeVerificationCode(input.code);
  try {
    return await prisma.verificationCode.update({
      where: { id },
      data: {
        code,
        description: cleanDescription(input.description),
        maxUses: input.maxUses ?? null,
        expiresAt: input.expiresAt ?? null,
        active: input.active ?? existing.active,
        oneTimePerMember: input.oneTimePerMember ?? existing.oneTimePerMember,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new VerificationCodeError(
        `Code ${code} already exists in this server.`,
        "DUPLICATE",
      );
    }
    throw error;
  }
}

export async function setVerificationCodeRoles(input: {
  id: string;
  guildId: string;
  roleIds: string[];
}): Promise<VerificationCode> {
  const result = await prisma.verificationCode.updateMany({
    where: { id: input.id, guildId: input.guildId },
    data: { roleIds: { set: uniqueIds(input.roleIds) } },
  });
  if (result.count !== 1) {
    throw new VerificationCodeError(
      "Verification code not found.",
      "NOT_FOUND",
    );
  }
  return prisma.verificationCode.findUniqueOrThrow({ where: { id: input.id } });
}

export async function deleteVerificationCode(input: {
  id: string;
  guildId: string;
}): Promise<VerificationCode> {
  return prisma.$transaction(async (tx) => {
    const code = await tx.verificationCode.findFirst({
      where: { id: input.id, guildId: input.guildId },
    });
    if (!code) {
      throw new VerificationCodeError(
        "Verification code not found.",
        "NOT_FOUND",
      );
    }
    const processing = await tx.verificationAttempt.count({
      where: {
        codeId: code.id,
        status: VerificationAttemptStatus.PROCESSING,
      },
    });
    if (processing > 0) {
      throw new VerificationCodeError(
        "This code is completing a verification right now. Try deleting it again in a moment.",
        "IN_USE",
      );
    }
    await tx.verificationAttempt.updateMany({
      where: {
        codeId: code.id,
        status: VerificationAttemptStatus.PENDING,
      },
      data: {
        status: VerificationAttemptStatus.FAILED,
        failureReason: "Verification code was deleted by an administrator.",
      },
    });
    return tx.verificationCode.delete({ where: { id: code.id } });
  });
}

export async function listVerificationCodes(guildId: string, take = 100) {
  return prisma.verificationCode.findMany({
    where: { guildId },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    take,
  });
}

export async function getVerificationCode(reference: string, guildId: string) {
  const normalized = reference.trim().toUpperCase();
  const code = await prisma.verificationCode.findFirst({
    where: {
      guildId,
      OR: [{ id: reference }, { code: normalized }],
    },
  });
  if (!code) {
    throw new VerificationCodeError(
      "Verification code not found.",
      "NOT_FOUND",
    );
  }
  return code;
}

export async function validateVerificationCodeForAttempt(input: {
  guildId: string;
  userId: string;
  value: string;
  preventCodeReuse: boolean;
  now?: Date;
}): Promise<VerificationCode> {
  const codeValue = normalizeVerificationCode(input.value);
  const code = await prisma.verificationCode.findUnique({
    where: {
      guildId_code: {
        guildId: input.guildId,
        code: codeValue,
      },
    },
  });
  if (!code) {
    throw new VerificationCodeError(
      "Verification code not found.",
      "NOT_FOUND",
    );
  }
  assertCodeAvailable(code, input.now ?? new Date());
  if (input.preventCodeReuse && code.oneTimePerMember) {
    const redeemed = await prisma.verificationRedemption.findFirst({
      where: {
        guildId: input.guildId,
        codeId: code.id,
        userId: input.userId,
      },
      select: { id: true },
    });
    if (redeemed) {
      throw new VerificationCodeError(
        "This member already redeemed that code.",
        "ALREADY_REDEEMED",
      );
    }
  }
  return code;
}

export function assertCodeAvailable(
  code: Pick<VerificationCode, "active" | "expiresAt" | "maxUses" | "uses">,
  now = new Date(),
): void {
  if (!code.active) {
    throw new VerificationCodeError(
      "Verification code is inactive.",
      "INACTIVE",
    );
  }
  if (code.expiresAt && code.expiresAt <= now) {
    throw new VerificationCodeError(
      "Verification code has expired.",
      "EXPIRED",
    );
  }
  if (code.maxUses !== null && code.uses >= code.maxUses) {
    throw new VerificationCodeError(
      "Verification code has reached its maximum uses.",
      "EXHAUSTED",
    );
  }
}

function cleanDescription(value?: string | null): string | null {
  const description = value?.trim();
  return description ? description.slice(0, 500) : null;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))].slice(0, 20);
}
