"use client";

import useSWR from "swr";
import Link from "next/link";
import { useState } from "react";

const fetcher = (u: string) => fetch(u).then((r) => r.json());

interface Item {
  id: string;
  kind: "personal" | "announcement";
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  unread: boolean;
  createdAt: string;
}

export function NotificationsBell() {
  const { data, mutate } = useSWR<{ items: Item[]; unread: number }>(
    "/api/me/notifications",
    fetcher,
    { refreshInterval: 30000 },
  );
  const [open, setOpen] = useState(false);
  const unread = data?.unread ?? 0;

  async function openFeed() {
    setOpen((v) => !v);
    if (!open && unread > 0) {
      await fetch("/api/me/notifications", { method: "POST" });
      mutate();
    }
  }

  return (
    <div className="relative">
      <button
        onClick={openFeed}
        className="relative rounded-lg p-1.5 text-kos-muted transition-colors hover:text-kos-fg"
        aria-label="Notifications"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 max-h-[70vh] w-80 overflow-y-auto rounded-2xl border border-kos-border bg-kos-bg shadow-2xl">
            <div className="border-b border-kos-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-kos-muted">
              Notifications
            </div>
            {!data || data.items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-kos-muted">
                Nothing yet — wins and announcements land here.
              </p>
            ) : (
              <div className="divide-y divide-kos-border/60">
                {data.items.map((n) => {
                  const inner = (
                    <div className="px-4 py-3 hover:bg-kos-fg/[0.03]">
                      <div className="flex items-center gap-2">
                        {n.kind === "personal" && n.type === "WIN" ? <span>🏆</span> : null}
                        {n.kind === "announcement" ? <span>📢</span> : null}
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{n.title}</span>
                        {n.unread ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" /> : null}
                      </div>
                      {n.body ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-kos-muted">{n.body}</p>
                      ) : null}
                      <p className="mt-1 text-[10px] text-kos-muted/70">
                        {new Date(n.createdAt).toLocaleString()}
                      </p>
                    </div>
                  );
                  return n.link ? (
                    <Link key={n.id} href={n.link} onClick={() => setOpen(false)} className="block">
                      {inner}
                    </Link>
                  ) : (
                    <div key={n.id}>{inner}</div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
