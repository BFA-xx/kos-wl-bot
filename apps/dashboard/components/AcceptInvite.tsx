"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AcceptInvite({ token, slug }: { token: string; slug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/invites/${token}/accept`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      router.push(`/${body.slug ?? slug}/dashboard`);
      router.refresh();
    } else {
      setBusy(false);
      setError(body.error ?? "Couldn't accept the invite.");
    }
  }

  return (
    <div className="mt-5">
      <button onClick={accept} disabled={busy} className="kos-btn-primary w-full">
        {busy ? "Joining…" : "Accept invite"}
      </button>
      {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
    </div>
  );
}
