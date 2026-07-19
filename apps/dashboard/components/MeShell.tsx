"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode, type SVGProps } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { NotificationsBell } from "./NotificationsBell";
import {
  IconCard,
  IconChart,
  IconClose,
  IconDoc,
  IconGrid,
  IconLogout,
  IconMegaphone,
  IconMenu,
  IconTicket,
  IconUsers,
  IconWallet,
} from "./icons";

type IconComponent = (props: SVGProps<SVGSVGElement>) => ReactNode;

const NAV: {
  href: string;
  label: string;
  exact?: boolean;
  Icon: IconComponent;
}[] = [
  { href: "/me", label: "Profile", exact: true, Icon: IconGrid },
  { href: "/me/raffles", label: "Raffles", Icon: IconTicket },
  { href: "/me/campaigns", label: "Campaigns", Icon: IconMegaphone },
  { href: "/me/points", label: "Points", Icon: IconChart },
  { href: "/me/rewards", label: "Rewards", Icon: IconCard },
  { href: "/me/wallets", label: "Wallets", Icon: IconWallet },
  { href: "/me/history", label: "History", Icon: IconDoc },
  { href: "/me/communities", label: "Communities", Icon: IconUsers },
];

export function MeShell({
  user,
  children,
}: {
  user: { name: string; avatarUrl: string | null };
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <div className="min-h-screen">
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[min(22rem,calc(100vw-2rem))] flex-col border-r border-white/[0.08] bg-[#0A0A0A] p-4 shadow-2xl">
            <button
              onClick={() => setOpen(false)}
              className="absolute right-3 top-4 rounded-lg p-1.5 text-kos-muted hover:bg-white/[0.05] hover:text-kos-fg"
              aria-label="Close menu"
            >
              <IconClose />
            </button>

            <div className="flex items-center gap-3 pr-10">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-violet-500 text-xs font-black tracking-tight text-white shadow-[0_14px_40px_-22px_rgba(59,130,246,0.9)]">
                KOS
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold">My KOS</div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-kos-muted">
                  Member Hub
                </div>
              </div>
            </div>

            <Link
              href="/"
              onClick={() => setOpen(false)}
              className="mt-5 flex items-center justify-between rounded-2xl border border-blue-400/20 bg-blue-500/10 px-3 py-3 text-sm font-medium text-blue-100 transition-colors hover:bg-blue-500/15"
            >
              <span>Team dashboards</span>
              <span className="text-xs text-blue-200/70">Switch</span>
            </Link>

            <nav className="mt-5 flex flex-1 flex-col gap-1 overflow-y-auto">
              {NAV.map((n) => {
                const isActive = active(n.href, n.exact);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                      isActive
                        ? "bg-white text-kos-bg"
                        : "text-kos-muted hover:bg-white/[0.05] hover:text-kos-fg"
                    }`}
                  >
                    <n.Icon
                      className={isActive ? "text-kos-bg" : "text-kos-muted"}
                    />
                    <span>{n.label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-white/[0.08] bg-white/[0.04] text-[10px] font-bold">
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
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {user.name}
                  </div>
                  <div className="text-xs text-kos-muted">Signed in</div>
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
          </aside>
        </div>
      ) : null}

      <header className="sticky top-0 z-20 border-b border-white/[0.08] bg-[#0A0A0A]/70 backdrop-blur-2xl">
        <div className="flex w-full items-center gap-3 px-4 py-3 sm:px-6 lg:px-8 xl:px-10">
          <button
            onClick={() => setOpen(true)}
            className="rounded-lg p-2 text-kos-muted hover:bg-white/[0.05] hover:text-kos-fg md:hidden"
            aria-label="Open menu"
          >
            <IconMenu />
          </button>
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

          <nav className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-full border border-white/[0.08] bg-white/[0.035] p-1 md:flex lg:flex-none">
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
            <div className="hidden h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-white/[0.08] bg-white/[0.04] text-[10px] font-bold sm:flex">
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
            <form
              action="/api/auth/logout"
              method="post"
              className="hidden sm:block"
            >
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
