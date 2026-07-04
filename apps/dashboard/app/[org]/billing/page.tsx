import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { PageTitle, Card, SectionTitle } from "@/components/ui";
import { IconCheck } from "@/components/icons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PLANS = [
  {
    name: "Free",
    price: "$0",
    features: ["Unlimited raffles", "1 connected server", "Verifiable proofs", "Wallet collection"],
    current: true,
  },
  {
    name: "Pro",
    price: "Coming soon",
    features: ["Multiple servers", "Campaigns & quests", "Priority support", "Custom branding"],
    current: false,
  },
  {
    name: "Scale",
    price: "Coming soon",
    features: ["Unlimited servers", "API access", "SSO & audit exports", "Dedicated support"],
    current: false,
  },
];

export default async function BillingPage({ params }: { params: { org: string } }) {
  let org;
  try {
    ({ org } = await requireOrgAccess(params.org));
  } catch (err) {
    if (err instanceof AccessError) redirect("/");
    throw err;
  }
  const sub = await prisma.subscription.findUnique({ where: { organizationId: org.id } });

  return (
    <>
      <PageTitle title="Billing" subtitle="Manage your plan and subscription." />

      <Card className="mb-5">
        <SectionTitle>Current plan</SectionTitle>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-semibold">{sub?.plan ?? "FREE"}</div>
            <div className="text-sm text-kos-muted">Status: {sub?.status ?? "ACTIVE"}</div>
          </div>
          <span className="kos-badge border-emerald-400/30 text-emerald-500 dark:text-emerald-300/90">
            active
          </span>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((p) => (
          <div
            key={p.name}
            className={`kos-card p-5 ${p.current ? "ring-1 ring-kos-fg/30" : ""}`}
          >
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">{p.name}</div>
              {p.current ? (
                <span className="kos-badge border-kos-border text-kos-muted">current</span>
              ) : null}
            </div>
            <div className="mt-1 text-2xl font-bold">{p.price}</div>
            <ul className="mt-4 space-y-2 text-sm">
              {p.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-kos-muted">
                  <IconCheck className="text-kos-fg" /> {f}
                </li>
              ))}
            </ul>
            <button
              disabled
              className="kos-btn mt-5 w-full cursor-not-allowed opacity-50"
              title="Paid plans are coming soon"
            >
              {p.current ? "Your plan" : "Coming soon"}
            </button>
          </div>
        ))}
      </div>

      <p className="mt-5 text-center text-xs text-kos-muted">
        Paid plans and metered billing are on the way. You're on Free — enjoy KOS.
      </p>
    </>
  );
}
