"use client";

import { useState } from "react";

interface Row {
  id: string;
  org: string;
  slug: string;
  plan: string;
  status: string;
}

const PLANS = ["FREE", "PRO", "SCALE"];
const STATUSES = ["ACTIVE", "PAST_DUE", "CANCELLED"];

export function SubscriptionsTable({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial);
  const [saving, setSaving] = useState<string | null>(null);

  async function update(id: string, patch: { plan?: string; status?: string }) {
    setSaving(id);
    const res = await fetch(`/api/admin/subscriptions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    setSaving(null);
    if (res.ok) {
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-kos-border">
      <table className="w-full text-sm">
        <thead className="bg-kos-panel/60 text-left text-xs uppercase tracking-wide text-kos-muted">
          <tr>
            <th className="px-4 py-3">Organization</th>
            <th className="px-4 py-3">Plan</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">{null}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-kos-border/60">
              <td className="px-4 py-3">
                <div className="font-medium">{r.org}</div>
                <div className="text-[11px] text-kos-muted">/{r.slug}</div>
              </td>
              <td className="px-4 py-3">
                <select
                  className="kos-input max-w-[130px] text-xs"
                  value={r.plan}
                  onChange={(e) => update(r.id, { plan: e.target.value })}
                >
                  {PLANS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-4 py-3">
                <select
                  className="kos-input max-w-[150px] text-xs"
                  value={r.status}
                  onChange={(e) => update(r.id, { status: e.target.value })}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-4 py-3 text-xs text-kos-muted">{saving === r.id ? "saving…" : ""}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-kos-muted">
                No subscriptions yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
