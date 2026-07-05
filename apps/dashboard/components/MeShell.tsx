"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { IconGrid, IconLogout, IconUsers, IconWallet, IconTicket } from "./icons";

const NAV = [
  { href: "/me", label: "Profile", exact: true },
  { href: "/me/wallets", label: "Wallets" },
  { href: "/me/history", label: "History" },
];

const SOON = ["Tasks", "Campaigns", "Points"];

export function MeShell({
  user,
  children,
}: {
  user: { name: string; avatarUrl: string | null };
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-kos-border bg-kos-bg/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href="/me" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-kos-fg text-xs font-black tracking-tight text-kos-bg">
              KOS
            </div>
            <span className="hidden text-sm font-semibold sm:block">My KOS</span>
          </Link>

          <nav className="flex items-center gap-1 overflow-x-auto">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  active(n.href, n.exact)
                    ? "bg-kos-fg/10 text-kos-fg"
                    : "text-kos-muted hover:text-kos-fg"
                }`}
              >
                {n.label}
              </Link>
            ))}
            {SOON.map((s) => (
              <span
                key={s}
                className="hidden cursor-default whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-kos-muted/40 md:block"
                title="Coming soon"
              >
                {s}
              </span>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link href="/" className="kos-btn hidden text-xs sm:block" title="Organization dashboards">
              Dashboard
            </Link>
            <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-kos-panel text-[10px] font-bold">
              {user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                user.name.slice(0, 2).toUpperCase()
              )}
            </div>
            <form action="/api/auth/logout" method="post">
              <button className="rounded-lg p-1.5 text-kos-muted hover:text-kos-fg" aria-label="Sign out">
                <IconLogout />
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="kos-fade">{children}</div>
      </main>

      <footer className="mx-auto max-w-5xl px-4 pb-8 pt-4 text-center text-xs text-kos-muted sm:px-6">
        Powered by KOS
      </footer>
    </div>
  );
}
