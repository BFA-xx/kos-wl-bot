"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { PageTitle, Card } from "@/components/ui";
import { IconMegaphone } from "@/components/icons";

export default function CampaignsPage() {
  const { org } = useParams<{ org: string }>();
  return (
    <>
      <PageTitle title="Campaigns" subtitle="Group raffles and quests into campaigns." />
      <Card>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-kos-border bg-kos-panel text-kos-muted">
            <IconMegaphone />
          </div>
          <div>
            <div className="font-medium">Campaigns are coming soon</div>
            <p className="mx-auto mt-1 max-w-md text-sm text-kos-muted">
              Bundle multiple raffles, social quests and reputation into a single
              campaign. For now, manage your whitelist raffles individually.
            </p>
          </div>
          <Link href={`/${org}/raffles`} className="kos-btn-primary">
            Go to Raffles
          </Link>
        </div>
      </Card>
    </>
  );
}
