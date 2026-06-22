import Link from "next/link";
import type { ReactNode } from "react";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/raffles", label: "Raffles" },
  { href: "/wallets", label: "Wallets" },
  { href: "/blacklist", label: "Blacklist" },
];

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-6">
      <header className="mb-8 flex items-center justify-between border-b border-kos-line pb-5">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-kos-border bg-kos-panel text-sm font-bold tracking-tight">
            KOS
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">KOS WL Bot</div>
            <div className="text-xs text-kos-grey">Raffle Management</div>
          </div>
        </Link>
        <nav className="flex items-center gap-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="rounded-lg px-3 py-2 text-sm text-kos-silver transition-colors hover:bg-kos-card hover:text-kos-white"
            >
              {n.label}
            </Link>
          ))}
          <form action="/api/auth/logout" method="post">
            <button className="ml-2 rounded-lg px-3 py-2 text-sm text-kos-grey transition-colors hover:text-kos-white">
              Sign out
            </button>
          </form>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="mt-12 border-t border-kos-line pt-5 text-center text-xs text-kos-grey">
        Powered by KOS
      </footer>
    </div>
  );
}
