"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const MESSAGES: Record<string, { text: string; bad?: boolean }> = {
  linked: { text: "X account linked ✓" },
  not_configured: { text: "X linking isn't configured yet — ask the KOS team.", bad: true },
  invalid_state: { text: "Linking session expired. Try again.", bad: true },
  token_exchange_failed: { text: "X rejected the request. Try again.", bad: true },
  profile_fetch_failed: { text: "Couldn't read your X profile. Try again.", bad: true },
  already_linked_elsewhere: {
    text: "That X account is already linked to a different KOS user.",
    bad: true,
  },
};

export function XConnectCard({
  linked,
}: {
  linked: { handle: string; avatar: string | null; since: string } | null;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("x");
    if (code) {
      setMsg(MESSAGES[code] ?? null);
      // Clean the query so refreshes don't re-show it.
      window.history.replaceState({}, "", "/me");
    }
  }, []);

  async function unlink() {
    if (!confirm("Unlink your X account? Task verifications tied to it stay recorded.")) return;
    setBusy(true);
    await fetch("/api/me/connections/x", { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="kos-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl border border-kos-border bg-kos-panel font-bold">
            {linked?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={linked.avatar} alt="" className="h-full w-full object-cover" />
            ) : (
              "𝕏"
            )}
          </div>
          <div>
            <div className="text-sm font-semibold">X (Twitter)</div>
            {linked ? (
              <div className="text-sm text-kos-muted">
                @{linked.handle}
                <span className="ml-2 text-[11px] text-kos-muted/70">linked {linked.since}</span>
              </div>
            ) : (
              <div className="text-sm text-kos-muted">
                Link once — every KOS community can then verify your X tasks.
              </div>
            )}
          </div>
        </div>
        {linked ? (
          <button onClick={unlink} disabled={busy} className="kos-btn text-xs">
            {busy ? "…" : "Unlink"}
          </button>
        ) : (
          <a href="/api/connect/x/start" className="kos-btn-primary whitespace-nowrap">
            Connect X
          </a>
        )}
      </div>
      {msg ? (
        <p className={`mt-3 text-sm ${msg.bad ? "text-red-400" : "text-emerald-400"}`}>{msg.text}</p>
      ) : null}
    </div>
  );
}
