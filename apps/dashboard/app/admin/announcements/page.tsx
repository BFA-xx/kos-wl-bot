import { prisma } from "@/lib/db";
import { guardAdmin } from "@/lib/admin-guard";
import { PageTitle, Card } from "@/components/ui";
import { AnnouncementsManager } from "@/components/admin/AnnouncementsManager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminAnnouncementsPage() {
  await guardAdmin();
  const [items, orgs] = await Promise.all([
    prisma.announcement.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <PageTitle title="Announcements" subtitle="Broadcast to all orgs or target a single one." />
      <Card>
        <AnnouncementsManager
          orgs={orgs}
          initial={items.map((a) => ({
            id: a.id,
            title: a.title,
            body: a.body,
            level: a.level,
            active: a.active,
            organizationId: a.organizationId,
            createdAt: a.createdAt.toISOString(),
          }))}
        />
      </Card>
    </>
  );
}
