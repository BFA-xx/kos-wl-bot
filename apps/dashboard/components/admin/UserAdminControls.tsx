"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function UserAdminToggle({
  id,
  isSuperAdmin,
  isSelf,
}: {
  id: string;
  isSuperAdmin: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    await fetch(`/api/admin/users/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isSuperAdmin: !isSuperAdmin }),
    });
    setBusy(false);
    router.refresh();
  }

  if (isSelf && isSuperAdmin) {
    return <span className="text-xs text-kos-muted">you</span>;
  }
  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`rounded-lg border px-2.5 py-1 text-xs ${
        isSuperAdmin
          ? "border-red-500/30 text-red-400 hover:bg-red-500/10"
          : "border-kos-border text-kos-muted hover:bg-kos-fg/5 hover:text-kos-fg"
      }`}
    >
      {isSuperAdmin ? "Revoke admin" : "Make admin"}
    </button>
  );
}

export function AddSuperAdmin() {
  const router = useRouter();
  const [id, setId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{5,25}$/.test(id.trim())) {
      setMsg("Enter a valid Discord user ID.");
      return;
    }
    const res = await fetch(`/api/admin/users/${id.trim()}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isSuperAdmin: true }),
    });
    if (res.ok) {
      setId("");
      setMsg("Added. They'll have Super Admin on their next login.");
      router.refresh();
    } else {
      const b = await res.json().catch(() => ({}));
      setMsg(b.error ?? "Failed.");
    }
  }

  return (
    <form onSubmit={add} className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
      <input
        className="kos-input sm:max-w-[280px]"
        placeholder="Discord user ID to make super-admin"
        value={id}
        onChange={(e) => setId(e.target.value)}
      />
      <button type="submit" className="kos-btn-primary whitespace-nowrap">
        Add super-admin
      </button>
      {msg ? <span className="text-sm text-kos-muted">{msg}</span> : null}
    </form>
  );
}
