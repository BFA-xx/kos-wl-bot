import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { hasPermission, type Permission } from "@/lib/permissions";
import type {
  User,
  Organization,
  OrganizationMember,
  OrganizationRole,
  Prisma,
} from "@prisma/client";

/**
 * The single authorization choke-point for the multi-tenant dashboard.
 *
 * Isolation rule: a Guild belongs to at most one Organization (GuildConnection
 * .guildId is unique), so an org's data is exactly the rows whose guild is one
 * of its connected guilds. EVERY org-scoped query must be filtered with
 * `guildScope(ctx.guildIds)` (or `raffleGuildScope`) — never trust a raw id
 * from the client.
 */

export class AccessError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "AccessError";
  }
}

export interface OrgContext {
  user: User;
  org: Organization;
  member: (OrganizationMember & { role: OrganizationRole }) | null;
  isOwner: boolean;
  permissions: string[];
  /** Discord guild ids connected to this org — the isolation anchor. */
  guildIds: string[];
}

/** The logged-in user, or 401. */
export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) throw new AccessError(401, "You must sign in.");
  return user;
}

/** Resolve an org by slug plus its connected guild ids. */
export async function resolveOrg(
  slug: string,
): Promise<{ org: Organization; guildIds: string[] } | null> {
  const org = await prisma.organization.findUnique({
    where: { slug },
    include: { guildConnections: { select: { guildId: true } } },
  });
  if (!org) return null;
  const { guildConnections, ...bare } = org;
  return { org: bare as Organization, guildIds: guildConnections.map((g) => g.guildId) };
}

/**
 * Require an authenticated user who is a member (or owner) of `slug`, and —
 * if a permission is given — holds it. Returns the full org context including
 * the connected `guildIds` used to scope every subsequent query.
 */
export async function requireOrgAccess(
  slug: string,
  permission?: Permission,
): Promise<OrgContext> {
  const user = await requireUser();
  const resolved = await resolveOrg(slug);
  if (!resolved) throw new AccessError(404, "Organization not found.");
  const { org, guildIds } = resolved;

  const isOwner = org.ownerId === user.id;
  const member = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
    include: { role: true },
  });

  if (!isOwner && (!member || member.status !== "ACTIVE")) {
    throw new AccessError(403, "You don't have access to this organization.");
  }

  const permissions = member?.role.permissions ?? [];
  if (permission && !hasPermission({ isOwner, permissions }, permission)) {
    throw new AccessError(403, `Missing permission: ${permission}`);
  }

  return { user, org, member: member ?? null, isOwner, permissions, guildIds };
}

/** Require a KOS super-admin (Super Admin console). Never a community owner. */
export async function requireSuperAdmin(): Promise<{ user: User }> {
  const user = await requireUser();
  if (!user.isSuperAdmin) throw new AccessError(403, "Forbidden.");
  return { user };
}

/** All orgs the user owns or actively belongs to (for the switcher / router). */
export async function getUserOrgs(userId: string): Promise<Organization[]> {
  const [owned, memberships] = await Promise.all([
    prisma.organization.findMany({ where: { ownerId: userId } }),
    prisma.organizationMember.findMany({
      where: { userId, status: "ACTIVE" },
      include: { organization: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const byId = new Map<string, Organization>();
  for (const o of owned) byId.set(o.id, o);
  for (const m of memberships) byId.set(m.organization.id, m.organization);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Prisma `where` fragment scoping guild-owned rows (Raffle, Blacklist, Log). */
export function guildScope(guildIds: string[]): { guildId: { in: string[] } } {
  return { guildId: { in: guildIds } };
}

/** Prisma `where` fragment scoping raffle-child rows (Participant, Winner). */
export function raffleGuildScope(guildIds: string[]): {
  raffle: { guildId: { in: string[] } };
} {
  return { raffle: { guildId: { in: guildIds } } };
}

/** Write an organization audit entry (best-effort). */
export async function logAudit(
  organizationId: string,
  actorId: string | null,
  action: string,
  opts: { targetType?: string; targetId?: string; metadata?: Prisma.InputJsonValue } = {},
): Promise<void> {
  await prisma.auditLog
    .create({
      data: {
        organizationId,
        actorId,
        action,
        targetType: opts.targetType,
        targetId: opts.targetId,
        metadata: opts.metadata,
      },
    })
    .catch(() => undefined);
}

/**
 * Wrap an API route handler so thrown AccessErrors become clean JSON responses.
 * Usage: `export const GET = withAccess(async (req) => { ... })`.
 */
export function withAccess(
  handler: (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>,
) {
  return async (req: Request, ctx: { params: Record<string, string> }) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof AccessError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      console.error("route error", err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  };
}
