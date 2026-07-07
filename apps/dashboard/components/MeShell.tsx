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
  { href: "/me/points", label: "Points" },
  { href: "/me/wallets", label: "Wallets" },
  { href: "/me/history", label: "History" },
  { href: "/me/communities", label: "Communities" },
];

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
        <div className="flex w-full items-center gap-3 px-4 py-3 sm:px-6 lg:px-8 xl:px-10">
          <Link href="/me" className="flex shrink-0 items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 text-xs font-black tracking-tight text-white shadow-[0_14px_40px_-22px_rgba(59,130,246,0.9)]">
              KOS
            </div>
            <div className="hidden leading-tight sm:block">
              <div className="text-sm font-semibold">My KOS</div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-kos-muted">
                Member Hub
              </div>
            </div>
          </Link>

          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-full border border-white/[0.08] bg-white/[0.035] p-1 lg:flex-none">
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
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <NotificationsBell />
            <ThemeToggle />
            <Link
              href="/"
              className="kos-btn hidden text-xs md:inline-flex"
              title="Organization dashboards"
            >
              Dashboard
            </Link>
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-white/[0.08] bg-white/[0.04] text-[10px] font-bold">
              {user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatarUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                user.name.slice(0, 2).toUpperCase()
              )}
            </div>
            <form action="/api/auth/logout" method="post">
              <button
                className="rounded-lg p-1.5 text-kos-muted hover:text-kos-fg"
                aria-label="Sign out"
              >
                <IconLogout />
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="w-full px-4 py-8 sm:px-6 lg:px-8 xl:px-10">
        <div className="kos-fade">{children}</div>
      </main>
    </div>
  );
}
