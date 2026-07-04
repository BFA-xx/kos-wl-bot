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
            Need a hand? Reach the KOS team in your Discord or by email. We
            typically respond within a day.
          </p>
          <a href="mailto:support@kos.app" className="kos-btn-primary mt-4 inline-block">
            Email support
          </a>
        </Card>
      </div>
    </>
  );
}
