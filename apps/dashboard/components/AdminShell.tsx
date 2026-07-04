"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";
import {
  IconGrid,
  IconUsers,
  IconCard,
  IconChart,
  IconServer,
  IconDoc,
  IconShield,
  IconMegaphone,
  IconMenu,
  IconClose,
  IconLogout,
} from "./icons";

const NAV = [
  { href: "/admin", label: "Organizations", Icon: IconGrid, exact: true },
  { href: "/admin/users", label: "Users", Icon: IconUsers },
  { href: "/admin/subscriptions", label: "Subscriptions", Icon: IconCard },
  { href: "/admin/revenue", label: "Revenue", Icon: IconChart },
  { href: "/admin/health", label: "Server Health", Icon: IconServer },
  { href: "/admin/logs", label: "Logs", Icon: IconDoc },
  { href: "/admin/flags", label: "Feature Flags", Icon: IconShield },
  { href: "/admin/announcements", label: "Announcements", Icon: IconMegaphone },
];

export function AdminShell({
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

  const Sidebar = ({ onNavigate }: { onNavigate?: () => void }) => (
    <div className="flex h-full flex-col">
      <div className="mb-8 flex items-center gap-3 px-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/90 text-kos-bg">
          <IconShield />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">KOS Admin</div>
          <div className="text-xs text-kos-muted">Super Admin</div>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV.map(({ href, label, Icon, exact }) => {
          const a = active(href, exact);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${
                a ? "bg-kos-fg/10 text-kos-fg" : "text-kos-muted hover:bg-kos-fg/5 hover:text-kos-fg"
              }`}
            >
              <Icon className={a ? "text-kos-fg" : "text-kos-muted group-hover:text-kos-fg"} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-4 space-y-2 border-t border-kos-border pt-4">
        <Link href="/" onClick={onNavigate} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-kos-muted hover:bg-kos-fg/5 hover:text-kos-fg">
          <IconGrid className="text-kos-muted" /> Back to app
        </Link>
        <form action="/api/auth/logout" method="post">
          <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-kos-muted hover:bg-kos-fg/5 hover:text-kos-fg">
            <IconLogout className="text-kos-muted" /> Sign out
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-kos-border bg-kos-bg/70 px-4 py-6 backdrop-blur-xl lg:block">
        <Sidebar />
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 border-r border-kos-border bg-kos-bg px-4 py-6">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-4 text-kos-muted" aria-label="Close">
              <IconClose />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-kos-border bg-kos-bg/60 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <button onClick={() => setOpen(true)} className="text-kos-muted lg:hidden" aria-label="Menu">
              <IconMenu />
            </button>
            <span className="rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-400">
              Internal · Super Admin
            </span>
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
              <span className="hidden text-sm text-kos-muted sm:block">{user.name}</span>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="kos-fade">{children}</div>
        </main>
      </div>
    </div>
  );
}
