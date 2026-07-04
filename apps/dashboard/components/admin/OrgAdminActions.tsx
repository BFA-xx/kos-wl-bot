"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function OrgAdminActions({
  id,
  name,
  suspended,
}: {
  id: string;
  name: string;
  suspended: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    await fetch(`/api/admin/orgs/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: suspended ? "resume" : "suspend" }),
    });
    setBusy(false);
    router.refresh();
  }

  async function kick() {
    if (!confirm(`Delete "${name}"? This removes their KOS space, members and roles. Their Discord server and raffles are NOT deleted.`)) return;
    setBusy(true);
    await fetch(`/api/admin/orgs/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        onClick={toggle}
        disabled={busy}
        className={`rounded-lg border px-2.5 py-1 text-xs ${
          suspended
            ? "border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/10"
            : "border-amber-400/30 text-amber-400 hover:bg-amber-400/10"
        }`}
      >
        {suspended ? "Resume" : "Pause"}
      </button>
      <button
        onClick={kick}
        disabled={busy}
        className="rounded-lg border border-red-500/30 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10"
      >
        Delete
      </button>
    </div>
  );
}
