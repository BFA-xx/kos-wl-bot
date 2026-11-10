import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "About KOS Raffles" };

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-5 py-12 leading-relaxed">
      <h1 className="text-3xl font-semibold">KOS Raffles</h1>
      <p>
        KOS Raffles helps communities run Discord and web raffles. Community
        teams can set entry requirements, collect wallet addresses for reward
        distribution, draw winners, and publish results.
      </p>
      <p>
        Community admins can optionally connect Google Sheets to create and
        update winner lists in their Google Drive and share them with reward
        partners. KOS uses the connected account to manage the spreadsheets it
        creates for this feature.
      </p>
      <nav aria-label="KOS Raffles" className="flex flex-wrap gap-5">
        <Link href="/login" className="underline">
          Sign in to KOS Raffles
        </Link>
        <Link href="/privacy" className="underline">
          Privacy policy
        </Link>
      </nav>
    </main>
  );
}
