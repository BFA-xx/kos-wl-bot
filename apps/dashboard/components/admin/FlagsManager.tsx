"use client";

import { useState } from "react";

interface Flag {
  key: string;
  enabled: boolean;
  description: string | null;
}

export function FlagsManager({ initial }: { initial: Flag[] }) {
  const [flags, setFlags] = useState(initial);
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");

  async function upsert(k: string, enabled: boolean, desc?: string) {
    const res = await fetch("/api/admin/flags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: k, enabled, description: desc }),
    });
    if (res.ok) {
      const { flag } = await res.json();
      setFlags((fs) => {
        const rest = fs.filter((f) => f.key !== flag.key);
        return [...rest, flag].sort((a, b) => a.key.localeCompare(b.key));
      });
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    await upsert(key.trim(), false, description || undefined);
    setKey("");
    setDescription("");
  }

  return (
    <div className="space-y-4">
      <form onSubmit={create} className="flex flex-col gap-2 sm:flex-row">
        <input className="kos-input" placeholder="flag.key" value={key} onChange={(e) => setKey(e.target.value)} />
        <input
          className="kos-input"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button className="kos-btn-primary whitespace-nowrap" type="submit">
          Add flag
        </button>
      </form>

      <div className="space-y-2">
        {flags.length === 0 ? (
          <p className="text-sm text-kos-muted">No feature flags yet.</p>
        ) : (
          flags.map((f) => (
            <div key={f.key} className="flex items-center justify-between rounded-xl border border-kos-border bg-kos-panel/50 p-3">
              <div className="min-w-0">
                <div className="truncate font-mono text-sm">{f.key}</div>
                {f.description ? <div className="text-xs text-kos-muted">{f.description}</div> : null}
              </div>
              <button
                onClick={() => upsert(f.key, !f.enabled)}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  f.enabled ? "bg-emerald-500/80" : "bg-kos-border"
                }`}
                aria-label="Toggle flag"
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                    f.enabled ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
