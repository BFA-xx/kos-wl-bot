"use client";

import useSWR from "swr";
import Link from "next/link";
import { useState } from "react";

const fetcher = (u: string) => fetch(u).then((r) => r.json());

interface Gate {
  key: string;
  label: string;
  ok: boolean;
  reason?: string;
  url?: string;
}
interface Status {
  status: string;
  entered: boolean;
  canEnter: boolean;
  discordOnly: boolean;
  gates: Gate[];
  entryCount: number | null;
  spots: number;
  error?: string;
}

/** Web Enter/Leave with the live gate checklist — parity with the bot's button. */
export function EntryPanel({
  raffleId,
  compact = false,
  taskControlsInline = false,
  loginHref,
}: {
  raffleId: number;
  compact?: boolean;
  taskControlsInline?: boolean;
  loginHref?: string;
}) {
  const { data, mutate } = useSWR<Status>(
    `/api/me/raffles/${raffleId}`,
    fetcher,
    {
      refreshInterval: 15000,
    },
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function act(action: "enter" | "leave") {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/me/raffles/${raffleId}/${action}`, {
      method: "POST",
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMsg(
        action === "enter"
          ? "You're in — good luck! 🎉"
          : "You left the raffle.",
      );
      mutate();
    } else if (body.error === "requirements") {
      setMsg("Some requirements aren't met yet — see the checklist below.");
      mutate();
    } else {
      setMsg(body.error ?? "Something went wrong.");
    }
  }

  if (!data) {
    return (
      <div
        className={`${compact ? "rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4" : "kos-card p-5"} text-sm text-kos-muted`}
      >
        Checking your eligibility…
      </div>
    );
  }
  if (data.error === "unauthorized") {
    return (
      <div
        className={`${compact ? "rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4" : "kos-card p-5"} text-center`}
      >
        <p className="text-sm text-kos-muted">
          Sign in with Discord to enter this raffle.
        </p>
        <a
          href={loginHref ?? "/api/auth/discord/login"}
          className="kos-btn-primary mt-3 inline-block"
        >
          Login with Discord to join this raffle
        </a>
      </div>
    );
  }

  const live = data.status === "LIVE";
  const showGates = live && !data.entered && data.gates.length > 0;
  const shell = compact
    ? "rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4"
    : "kos-card p-5";

  return (
    <div className={shell}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold">
            {data.entered
              ? "You're entered ✓"
              : live
                ? "Enter this raffle"
                : data.status === "UPCOMING"
                  ? "Not open yet"
                  : data.status === "ENDED"
                    ? "Raffle ended"
                    : "Entries closed"}
          </div>
          {data.entryCount !== null ? (
            <div className="text-xs text-kos-muted">
              {data.entryCount} entered · {data.spots} spots
            </div>
          ) : null}
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {live && !data.entered ? (
            <button
              onClick={() => act("enter")}
              disabled={busy || !data.canEnter}
              className="kos-btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {busy ? "Entering…" : "Enter raffle"}
            </button>
          ) : null}
          {live && data.entered ? (
            <button
              onClick={() => act("leave")}
              disabled={busy}
              className="kos-btn ml-auto"
            >
              {busy ? "…" : "Leave"}
            </button>
          ) : null}
        </div>
      </div>

      {showGates ? (
        <div className="mt-4 grid gap-2 border-t border-white/[0.08] pt-4 sm:grid-cols-2">
          {data.gates.map((g) => (
            <div
              key={g.key}
              className="flex items-start gap-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3 text-sm"
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  g.ok
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-kos-panel text-kos-muted"
                }`}
              >
                {g.ok ? "✓" : "·"}
              </span>
              <div className="min-w-0">
                <span className={g.ok ? "" : "text-kos-muted"}>{g.label}</span>
                {!g.ok && g.reason ? (
                  <div className="text-xs text-kos-muted/80">
                    {g.reason}{" "}
                    {taskControlsInline &&
                    (g.key.startsWith("task-") ||
                      g.key.startsWith("legacy-task-")) ? (
                      <span className="text-kos-fg">
                        Use the raffle steps above.
                      </span>
                    ) : g.url ? (
                      <Link
                        href={g.url}
                        className="text-kos-fg underline-offset-2 hover:underline"
                      >
                        Fix it →
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {data.discordOnly ? (
            <p className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs text-amber-300/90 sm:col-span-2">
              This raffle has a Discord-native requirement — enter it from
              Discord.
            </p>
          ) : null}
        </div>
      ) : null}

      {msg ? <p className="mt-3 text-sm text-kos-muted">{msg}</p> : null}
    </div>
  );
}
