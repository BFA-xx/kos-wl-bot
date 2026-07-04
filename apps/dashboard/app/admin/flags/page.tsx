import { prisma } from "@/lib/db";
import { guardAdmin } from "@/lib/admin-guard";
import { PageTitle, Card } from "@/components/ui";
import { FlagsManager } from "@/components/admin/FlagsManager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminFlagsPage() {
  await guardAdmin();
  const flags = await prisma.featureFlag.findMany({ orderBy: { key: "asc" } });

  return (
    <>
      <PageTitle title="Feature Flags" subtitle="Toggle platform features globally." />
      <Card>
        <FlagsManager
          initial={flags.map((f) => ({ key: f.key, enabled: f.enabled, description: f.description }))}
        />
      </Card>
    </>
  );
}
