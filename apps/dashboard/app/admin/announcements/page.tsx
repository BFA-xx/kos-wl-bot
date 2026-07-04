import { prisma } from "@/lib/db";
import { guardAdmin } from "@/lib/admin-guard";
import { PageTitle, Card } from "@/components/ui";
import { AnnouncementsManager } from "@/components/admin/AnnouncementsManager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminAnnouncementsPage() {
  await guardAdmin();
  const items = await prisma.announcement.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <>
      <PageTitle title="Announcements" subtitle="Broadcast a message across the platform." />
      <Card>
        <AnnouncementsManager
          initial={items.map((a) => ({
            id: a.id,
            title: a.title,
            body: a.body,
            level: a.level,
            active: a.active,
            createdAt: a.createdAt.toISOString(),
          }))}
        />
      </Card>
    </>
  );
}
