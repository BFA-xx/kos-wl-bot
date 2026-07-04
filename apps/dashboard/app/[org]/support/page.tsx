import { PageTitle, Card, SectionTitle } from "@/components/ui";
import { SupportContact } from "@/components/SupportContact";
import { IconLife } from "@/components/icons";

export const metadata = { title: "Support & Guide — KOS" };

const STEPS: { title: string; body: string }[] = [
  {
    title: "1 · Create your organization",
    body: "Your organization is your community's space on KOS, with its own dashboard, team and branding. You made this at sign-up — set your logo and banner under Settings → Branding.",
  },
  {
    title: "2 · Connect your Discord server",
    body: "Settings → Discord servers → click Invite bot to add the KOS bot to your server, then Connect. Once connected, all raffles in that server show up here. You must be the server owner or have Manage Server.",
  },
  {
    title: "3 · Host a raffle",
    body: "Raffles → + New raffle: pick the server + channel, set the project name, title (e.g. GTD / FCFS), WL spots, eligible roles, timing and wallet chains. The bot posts it to Discord within a few seconds. You can also run /raffle directly in Discord.",
  },
  {
    title: "4 · Track entries live",
    body: "Open a raffle to watch entries stream in, search participants, and copy usernames. The Dashboard shows live activity; Analytics shows trends and top hosts.",
  },
  {
    title: "5 · End & pick winners",
    body: "A raffle ends automatically at its end time, or hit End Now on the raffle page. Winners are drawn with a verifiable, cryptographically-committed random seed. Not happy? Reroll the whole pool or specific winners.",
  },
  {
    title: "6 · Collect winner wallets",
    body: "Winners are prompted to submit a wallet for the raffle's chain. See them all under Wallets, export to CSV/Excel, and grab the verifiable proof under Reports.",
  },
];

const ROLES: { name: string; body: string }[] = [
  { name: "Owner", body: "Full control, including transferring or deleting the org." },
  { name: "Admin", body: "Everything except transfer/delete — run raffles, export wallets, manage members, branding." },
  { name: "Moderator", body: "Run raffles day-to-day: create/edit/reroll/end + view data and export reports." },
  { name: "Collab Manager", body: "For collab partners: create/edit raffles + view participants, analytics, reports." },
  { name: "Viewer", body: "Read-only access to participants, wallets, analytics and reports." },
];

export default function SupportPage() {
  return (
    <>
      <PageTitle title="Support & Guide" subtitle="Everything you need to run KOS for your community." />

      <Card className="mb-5">
        <SectionTitle>Getting started</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          {STEPS.map((s) => (
            <div key={s.title} className="rounded-xl border border-kos-border bg-kos-panel/50 p-4">
              <div className="text-sm font-semibold">{s.title}</div>
              <p className="mt-1 text-sm text-kos-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mb-5">
        <SectionTitle>Team roles</SectionTitle>
        <p className="mb-3 text-sm text-kos-muted">
          Invite teammates under <strong>Team</strong> (by Discord ID or a shareable link) and give
          each the right role:
        </p>
        <div className="space-y-2">
          {ROLES.map((r) => (
            <div key={r.name} className="flex flex-col gap-1 rounded-xl border border-kos-border bg-kos-panel/50 p-3 sm:flex-row sm:items-baseline sm:gap-3">
              <span className="w-32 shrink-0 text-sm font-semibold">{r.name}</span>
              <span className="text-sm text-kos-muted">{r.body}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-kos-border bg-kos-panel text-kos-muted">
              <IconLife />
            </div>
            <div>
              <div className="font-medium">Tips</div>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-kos-muted">
                <li>Winners must add a wallet to be included in the address export.</li>
                <li>Use the Blacklist to keep known alts/farmers out.</li>
                <li>Every completed raffle has a verifiable proof under Reports.</li>
                <li>Scheduled raffles ping @everyone when they go live.</li>
              </ul>
            </div>
          </div>
        </Card>
        <Card>
          <div className="font-medium">Need a hand?</div>
          <p className="mt-1 text-sm text-kos-muted">
            Reach the KOS team by email, or DM the developer on X. We usually reply within a day.
          </p>
          <SupportContact />
        </Card>
      </div>
    </>
  );
}
