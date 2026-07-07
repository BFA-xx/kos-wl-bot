"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { OrgProvider, type OrgClientContext } from "@/lib/org-context";
import { OrgSidebarContent } from "./OrgSidebar";
import { ThemeToggle } from "./ThemeToggle";
import { AnnouncementBanner, type BannerItem } from "./AnnouncementBanner";
import { IconMenu, IconClose, IconSearch, IconChevron } from "./icons";

export function OrgShell({
  ctx,
  announcements = [],
  children,
}: {
  ctx: OrgClientContext;
  announcements?: BannerItem[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [q, setQ] = useState("");
  const router = useRouter();

  function search(e: React.FormEvent) {
    e.preventDefault();
    const t = q.trim();
    if (!t) return;
    const n = t.replace(/^#/, "");
    router.push(
      /^\d+$/.test(n) ? `/${ctx.slug}/raffles/${n}` : `/${ctx.slug}/raffles`,
    );
    setOpen(false);
  }

  return (
    <OrgProvider value={ctx}>
      <div className="min-h-screen">
        {/* Desktop sidebar */}
        <aside
          className={`fixed inset-y-0 left-0 z-30 hidden border-r border-white/[0.08] bg-[#0A0A0A]/85 px-4 py-5 backdrop-blur-2xl transition-all duration-300 lg:block ${
            collapsed ? "w-24" : "w-72"
          }`}
        >
          <div className="mb-5 flex items-center justify-between gap-2">
            {collapsed ? (
              <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 text-xs font-black text-white">
                K
              </div>
            ) : (
              <div>
                <div className="text-sm font-semibold tracking-tight">KOS</div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-kos-muted">
                  Command Center
                </div>
              </div>
            )}
            <button
              onClick={() => setCollapsed((v) => !v)}
              className="kos-btn hidden h-8 w-8 p-0 lg:inline-flex"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <IconChevron
                className={`h-4 w-4 transition-transform ${collapsed ? "-rotate-90" : "rotate-90"}`}
              />
            </button>
          </div>
          <OrgSidebarContent collapsed={collapsed} />
        </aside>

        {/* Mobile drawer */}
        {open ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 w-80 border-r border-white/[0.08] bg-[#0A0A0A] px-4 py-6 shadow-2xl">
              <button
                onClick={() => setOpen(false)}
                className="absolute right-3 top-4 rounded-lg p-1.5 text-kos-muted hover:text-kos-fg"
                aria-label="Close menu"
              >
                <IconClose />
              </button>
              <OrgSidebarContent onNavigate={() => setOpen(false)} />
            </div>
          </div>
        ) : null}

        {/* Main column */}
        <div
          className={`transition-all duration-300 ${collapsed ? "lg:pl-24" : "lg:pl-72"}`}
        >
          <header className="sticky top-0 z-20 border-b border-white/[0.08] bg-[#0A0A0A]/70 backdrop-blur-2xl">
            <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
              <button
                onClick={() => setOpen(true)}
                className="rounded-lg p-2 text-kos-muted hover:text-kos-fg lg:hidden"
                aria-label="Open menu"
              >
                <IconMenu />
              </button>
              <form onSubmit={search} className="relative max-w-md flex-1">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-kos-muted" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search raffle #, project, or jump…"
                  className="kos-input h-10 pl-9"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-kos-muted sm:block">
                  /
                </span>
              </form>
              <div className="ml-auto flex items-center gap-2">
                <Link
                  href="/me"
                  className="kos-btn hidden h-10 px-3 text-xs sm:inline-flex"
                >
                  My profile
                </Link>
                <Link
                  href="/me"
                  className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/[0.10] bg-white/[0.04] text-[11px] font-bold text-kos-fg transition-colors hover:border-white/[0.18] hover:bg-white/[0.07]"
                  aria-label="Open My KOS profile"
                  title="My KOS profile"
                >
                  {ctx.user.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={ctx.user.avatarUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    ctx.user.name.slice(0, 2).toUpperCase()
                  )}
                </Link>
                <ThemeToggle />
              </div>
            </div>
          </header>

          <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            <AnnouncementBanner items={announcements} />
            <div className="kos-fade">{children}</div>
          </main>

        </div>
      </div>
    </OrgProvider>
  );
}
