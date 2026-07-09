import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, getUserOrgs } from "@/lib/access";
import { OrgShell } from "@/components/OrgShell";

export const dynamic = "force-dynamic";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { org: string };
}) {
  let access;
  try {
    access = await requireOrgAccess(params.org);
  } catch (err) {
    if (err instanceof AccessError) {
      if (err.status === 401) {
        redirect(`/login?next=${encodeURIComponent(`/${params.org}/dashboard`)}`);
      }
      if (err.status === 404) notFound();
      redirect("/"); // 403 — bounce to their own orgs
    }
    throw err;
  }

  const { user, org, isOwner, permissions, guildIds } = access;

  // Suspended by a KOS super-admin — show a notice instead of the dashboard.
  if (org.suspendedAt) {
    return (
      <div className="flex min-h-screen items-center justify-center px-5 text-center">
        <div className="max-w-sm rounded-2xl border border-kos-border bg-kos-panel/60 p-8 backdrop-blur-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-400/10 text-amber-400">
            !
          </div>
          <h1 className="mt-4 text-lg font-semibold">{org.name} is paused</h1>
          <p className="mt-2 text-sm text-kos-muted">
            This organization has been suspended by KOS. Reach out to support if
            you think this is a mistake.
          </p>
          <a href="mailto:Theonlyrealoutis@gmail.com" className="kos-btn mt-5 inline-block">
            Contact support
          </a>
        </div>
      </div>
    );
  }

  const orgs = await getUserOrgs(user.id);
  const missingLogoOrgIds = orgs.filter((o) => !o.logoUrl).map((o) => o.id);
  const fallbackLogoByOrgId = new Map<string, string>();
  if (missingLogoOrgIds.length) {
    const connections = await prisma.guildConnection.findMany({
      where: { organizationId: { in: missingLogoOrgIds } },
      select: { organizationId: true, guildId: true, isPrimary: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    const guilds = await prisma.guild.findMany({
      where: {
        id: { in: connections.map((c) => c.guildId) },
        iconUrl: { not: null },
      },
      select: { id: true, iconUrl: true },
    });
    const guildIconById = new Map<string, string>();
    for (const guild of guilds) {
      if (guild.iconUrl) guildIconById.set(guild.id, guild.iconUrl);
    }
    for (const connection of connections) {
      const iconUrl = guildIconById.get(connection.guildId);
      if (iconUrl && !fallbackLogoByOrgId.has(connection.organizationId)) {
        fallbackLogoByOrgId.set(connection.organizationId, iconUrl);
      }
    }
  }

  // Active announcements: platform-wide (null) or targeted at this org.
  const announcements = await prisma.announcement.findMany({
    where: { active: true, OR: [{ organizationId: null }, { organizationId: org.id }] },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, title: true, body: true, level: true },
  });

  // Fall back to the connected Discord server's icon when no logo is set.
  let logoUrl = org.logoUrl;
  if (!logoUrl && guildIds.length) {
    const g = await prisma.guild.findFirst({
      where: { id: { in: guildIds }, iconUrl: { not: null } },
      select: { iconUrl: true },
    });
    logoUrl = g?.iconUrl ?? null;
  }

  const ctx = {
    slug: org.slug,
    name: org.name,
    logoUrl,
    isOwner,
    isSuperAdmin: user.isSuperAdmin,
    permissions,
    user: {
      id: user.id,
      name: user.globalName ?? user.username,
      avatarUrl: user.avatarUrl,
    },
    orgs: orgs.map((o) => ({
      slug: o.slug,
      name: o.name,
      logoUrl: o.logoUrl ?? fallbackLogoByOrgId.get(o.id) ?? null,
    })),
  };

  return (
    <OrgShell ctx={ctx} announcements={announcements}>
      {children}
    </OrgShell>
  );
}
