"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { NotificationsBell } from "./NotificationsBell";
import { IconLogout } from "./icons";

const NAV = [
  { href: "/me", label: "Profile", exact: true },
  { href: "/me/tasks", label: "Tasks" },
  { href: "/me/wallets", label: "Wallets" },
  { href: "/me/history", label: "History" },
  { href: "/me/communities", label: "Communities" },
];

const SOON = ["Points"];

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
      <header className="sticky top-0 z-20 border-b border-white/[0.08] bg-[#0A0A0A]/70 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href="/me" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 text-xs font-black tracking-tight text-white shadow-[0_14px_40px_-22px_rgba(59,130,246,0.9)]">
              KOS
            </div>
            <div className="hidden leading-tight sm:block">
              <div className="text-sm font-semibold">My KOS</div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-kos-muted">Member Hub</div>
            </div>
          </Link>

          <nav className="flex items-center gap-1 overflow-x-auto rounded-full border border-white/[0.08] bg-white/[0.035] p-1">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-all ${
                  active(n.href, n.exact)
                    ? "bg-white text-kos-bg shadow-sm"
                    : "text-kos-muted hover:bg-white/[0.05] hover:text-kos-fg"
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
            <NotificationsBell />
            <ThemeToggle />
            <Link href="/" className="kos-btn hidden text-xs md:inline-flex" title="Organization dashboards">
              Dashboard
            </Link>
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-white/[0.08] bg-white/[0.04] text-[10px] font-bold">
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

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="kos-fade">{children}</div>
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 pt-4 text-center text-xs text-kos-muted sm:px-6">
        Powered by KOS
      </footer>
    </div>
  );
}
