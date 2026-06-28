"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { SidebarContent } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { IconMenu, IconClose, IconSearch } from "./icons";

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const router = useRouter();

  function search(e: React.FormEvent) {
    e.preventDefault();
    const t = q.trim();
    if (!t) return;
    const n = t.replace(/^#/, "");
    router.push(/^\d+$/.test(n) ? `/raffles/${n}` : "/raffles");
    setOpen(false);
  }

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-kos-border bg-kos-bg/70 px-4 py-6 backdrop-blur-xl lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 border-r border-kos-border bg-kos-bg px-4 py-6">
            <button
              onClick={() => setOpen(false)}
              className="absolute right-3 top-4 rounded-lg p-1.5 text-kos-muted hover:text-kos-fg"
              aria-label="Close menu"
            >
              <IconClose />
            </button>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}

      {/* Main column */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-kos-border bg-kos-bg/60 backdrop-blur-xl">
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
                placeholder="Search raffle # or name…"
                className="kos-input pl-9"
              />
            </form>
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
              <div className="hidden text-right sm:block">
                <div className="text-xs font-medium">Manager</div>
                <div className="text-[11px] text-kos-muted">KOS Console</div>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-kos-fg text-xs font-bold text-kos-bg">
                KOS
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="kos-fade">{children}</div>
        </main>

        <footer className="mx-auto max-w-7xl px-4 pb-8 pt-6 text-center text-xs text-kos-muted sm:px-6 lg:px-8">
          Powered by KOS
        </footer>
      </div>
    </div>
  );
}
