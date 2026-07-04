import { prisma } from "@/lib/db";
import { BUILTIN_ROLES, OWNER_ROLE } from "@/lib/permissions";
import type { Organization } from "@prisma/client";

/** Slugs that can't be used as an org handle (they're real routes). */
export const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "login",
  "logout",
  "onboarding",
  "invite",
  "select",
  "settings",
  "app",
  "s",
  "_next",
  "favicon.ico",
  "public",
  "static",
  "new",
]);

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,31}$/.test(slug) && !RESERVED_SLUGS.has(slug);
}

/** True if the slug is available (not reserved, not taken). */
export async function slugAvailable(slug: string): Promise<boolean> {
  if (!isValidSlug(slug)) return false;
  const existing = await prisma.organization.findUnique({ where: { slug } });
  return !existing;
}

/**
 * Create an organization with the full default set: the 5 built-in roles, the
 * owner as an ACTIVE Owner member, and a FREE/ACTIVE subscription. Atomic.
 */
export async function createOrganizationWithDefaults(input: {
  slug: string;
  name: string;
  ownerId: string;
  logoUrl?: string | null;
}): Promise<Organization> {
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        slug: input.slug,
        name: input.name,
        logoUrl: input.logoUrl ?? null,
        ownerId: input.ownerId,
      },
    });

    await tx.organizationRole.createMany({
      data: BUILTIN_ROLES.map((r) => ({
        organizationId: org.id,
        name: r.name,
        permissions: r.permissions,
        isSystem: true,
      })),
    });

    const ownerRole = await tx.organizationRole.findFirstOrThrow({
      where: { organizationId: org.id, name: OWNER_ROLE },
    });

    await tx.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: input.ownerId,
        roleId: ownerRole.id,
        status: "ACTIVE",
      },
    });

    await tx.subscription.create({
      data: { organizationId: org.id, plan: "FREE", status: "ACTIVE" },
    });

    return org;
  });
}
