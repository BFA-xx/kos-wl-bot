"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TelegramConnectCard({
  linked,
}: {
  linked: {
    handle: string | null;
    displayName: string | null;
    since: string;
  } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function connect() {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/me/connections/telegram/link", {
      method: "POST",
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok || !body.url) {
      setMessage(body.error ?? "Telegram linking could not be started.");
      return;
    }
    window.location.assign(body.url);
  }

  async function unlink() {
    if (!confirm("Unlink this Telegram account from KOS?")) return;
    setBusy(true);
    const response = await fetch("/api/me/connections/telegram", {
      method: "DELETE",
    });
    setBusy(false);
    if (!response.ok) {
      setMessage("Telegram could not be unlinked.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="kos-card p-5">
      <div className="flex flex-col items-stretch justify-between gap-3 min-[440px]:flex-row min-[440px]:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#229ED9]/30 bg-[#229ED9]/10 text-sm font-black text-[#7dd3fc]">
            TG
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">Telegram</div>
            {linked ? (
              <div className="truncate text-sm text-kos-muted">
                {linked.handle
                  ? `@${linked.handle}`
                  : linked.displayName || "Connected"}
                <span className="ml-2 text-[11px] text-kos-muted/70">
                  linked {linked.since}
                </span>
              </div>
            ) : (
              <div className="text-sm text-kos-muted">
                Connect for Telegram raffle entry and community activities.
              </div>
            )}
          </div>
        </div>
        <button
          onClick={linked ? unlink : connect}
          disabled={busy}
          className={`${linked ? "kos-btn" : "kos-btn-primary"} w-full whitespace-nowrap text-xs min-[440px]:w-auto`}
        >
          {busy ? "Working..." : linked ? "Unlink" : "Connect Telegram"}
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-red-400">{message}</p> : null}
    </div>
  );
}
