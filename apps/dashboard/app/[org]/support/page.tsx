import { PageTitle, Card } from "@/components/ui";
import { IconLife } from "@/components/icons";

export default function SupportPage() {
  return (
    <>
      <PageTitle title="Support" subtitle="Get help running KOS for your community." />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-kos-border bg-kos-panel text-kos-muted">
              <IconLife />
            </div>
            <div>
              <div className="font-medium">Documentation</div>
              <p className="mt-1 text-sm text-kos-muted">
                Learn how to run raffles, connect servers, manage your team and
                deliver whitelist spots.
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="font-medium">Contact us</div>
          <p className="mt-1 text-sm text-kos-muted">
            Need a hand? Reach the KOS team by email, or DM the developer on X.
            We typically respond within a day.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href="mailto:Theonlyrealoutis@gmail.com" className="kos-btn-primary inline-block">
              Email support
            </a>
            <a
              href="https://x.com/Tosincrypt"
              target="_blank"
              rel="noreferrer"
              className="kos-btn inline-block"
            >
              DM @Tosincrypt on X ↗
            </a>
          </div>
        </Card>
      </div>
    </>
  );
}
