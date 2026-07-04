"use client";

import { useEffect, useState } from "react";
import { IconClose } from "./icons";

export interface BannerItem {
  id: string;
  title: string;
  body: string;
  level: string;
}

const STYLES: Record<string, string> = {
  INFO: "border-kos-border bg-kos-panel/70 text-kos-fg",
  WARNING: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  CRITICAL: "border-red-500/30 bg-red-500/10 text-red-300",
};

const KEY = "kos-dismissed-announcements";

export function AnnouncementBanner({ items }: { items: BannerItem[] }) {
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    try {
      setDismissed(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
    } catch {
      /* ignore */
    }
  }, []);

  function dismiss(id: string) {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  const visible = items.filter((i) => !dismissed.includes(i.id));
  if (visible.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {visible.map((a) => (
        <div
          key={a.id}
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 backdrop-blur-xl ${
            STYLES[a.level] ?? STYLES.INFO
          }`}
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{a.title}</div>
            <div className="text-sm opacity-90">{a.body}</div>
          </div>
          <button
            onClick={() => dismiss(a.id)}
            className="shrink-0 rounded-lg p-1 opacity-70 hover:opacity-100"
            aria-label="Dismiss"
          >
            <IconClose />
          </button>
        </div>
      ))}
    </div>
  );
}
