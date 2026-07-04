import { prisma } from "@/lib/db";
import { guardAdmin } from "@/lib/admin-guard";
import { PageTitle } from "@/components/ui";
import { SubscriptionsTable } from "@/components/admin/SubscriptionsTable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminSubscriptionsPage() {
  await guardAdmin();

  const subs = await prisma.subscription.findMany({
    include: { organization: { select: { name: true, slug: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <PageTitle title="Subscriptions" subtitle="Manage each organization's plan." />
      <SubscriptionsTable
        initial={subs.map((s) => ({
          id: s.id,
          org: s.organization.name,
          slug: s.organization.slug,
          plan: s.plan,
          status: s.status,
        }))}
      />
    </>
  );
}
