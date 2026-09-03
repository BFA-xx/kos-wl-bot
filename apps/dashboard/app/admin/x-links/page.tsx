import { guardAdmin } from "@/lib/admin-guard";
import { findXLinks } from "@/lib/telegram/x-link-admin";
import { PageTitle, Card, SectionTitle, Empty } from "@/components/ui";
import { XLinksTable } from "@/components/admin/XLinksTable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminXLinksPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  await guardAdmin();
  const query = searchParams.q ?? "";
  const links = await findXLinks(query);

  return (
    <>
      <PageTitle
        title="X Links"
        subtitle="X accounts connected to Telegram members for the onboarding follow gate."
      />

      <Card>
        <SectionTitle>Linked accounts</SectionTitle>
        <form className="mb-4 flex gap-2" action="/admin/x-links" method="get">
          <input
            name="q"
            defaultValue={query}
            placeholder="X handle, Telegram handle, name or identity id"
            className="w-full rounded-lg border border-kos-border bg-kos-panel px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-lg border border-kos-border px-4 py-2 text-sm"
          >
            Search
          </button>
        </form>

        {links.length === 0 ? (
          <Empty>{query ? "No X links match that search." : "No X accounts linked yet."}</Empty>
        ) : (
          <XLinksTable links={links.map((l) => ({ ...l, linkedAt: l.linkedAt?.toISOString() ?? null }))} />
        )}

        <p className="mt-4 text-xs text-kos-muted">
          Unlinking frees that X account to be connected by a different member,
          and clears their confirmed follow so the onboarding gate resets. Use it
          when someone authorized the wrong account — not to bypass the gate.
        </p>
      </Card>
    </>
  );
}
