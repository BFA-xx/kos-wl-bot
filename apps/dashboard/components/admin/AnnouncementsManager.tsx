"use client";

import { useState } from "react";

interface Announcement {
  id: string;
  title: string;
  body: string;
  level: string;
  active: boolean;
  organizationId: string | null;
  createdAt: string;
}

const LEVELS = ["INFO", "WARNING", "CRITICAL"];

export function AnnouncementsManager({
  initial,
  orgs,
}: {
  initial: Announcement[];
  orgs: { id: string; name: string }[];
}) {
  const [items, setItems] = useState(initial);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [level, setLevel] = useState("INFO");
  const [target, setTarget] = useState("all");

  const orgName = (id: string | null) =>
    id ? orgs.find((o) => o.id === id)?.name ?? "an org" : "All orgs";

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    const res = await fetch("/api/admin/announcements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, body, level, organizationId: target === "all" ? null : target }),
    });
    if (res.ok) {
      const { announcement } = await res.json();
      setItems((xs) => [announcement, ...xs]);
      setTitle("");
      setBody("");
    }
  }

  async function remove(id: string) {
    await fetch(`/api/admin/announcements?id=${id}`, { method: "DELETE" });
    setItems((xs) => xs.filter((x) => x.id !== id));
  }

  return (
    <div className="space-y-4">
      <form onSubmit={create} className="space-y-2 rounded-xl border border-kos-border bg-kos-panel/50 p-4">
        <input className="kos-input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="kos-input min-h-[70px]" placeholder="Message" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <select className="kos-input max-w-[140px]" value={level} onChange={(e) => setLevel(e.target.value)}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <select className="kos-input max-w-[200px]" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="all">📢 All organizations</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} only
              </option>
            ))}
          </select>
          <button className="kos-btn-primary" type="submit">
            Publish
          </button>
        </div>
      </form>

      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-kos-muted">No announcements.</p>
        ) : (
          items.map((a) => (
            <div key={a.id} className="flex items-start justify-between gap-3 rounded-xl border border-kos-border bg-kos-panel/50 p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.title}</span>
                  <span className="kos-badge border-kos-border text-kos-muted">{a.level}</span>
                  <span className="kos-badge border-kos-border text-kos-muted">→ {orgName(a.organizationId)}</span>
                </div>
                <p className="mt-1 text-sm text-kos-muted">{a.body}</p>
              </div>
              <button onClick={() => remove(a.id)} className="text-xs text-kos-muted hover:text-red-400">
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
