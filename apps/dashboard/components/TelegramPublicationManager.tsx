"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((response) => response.json());

interface PublicationData {
  communities: {
    id: string;
    communityName: string;
    telegramChatId: string;
    defaultRaffleSettings: unknown;
  }[];
  publications: {
    id: string;
    communityId: string;
    telegramMessageId: string | null;
    winnerVisibility: "PUBLIC" | "ANONYMOUS" | "ADMIN_ONLY";
    autoAnnouncements: boolean;
    eligibilityRules: { type: string; checkAt: string }[];
  }[];
  error?: string;
}

export function TelegramPublicationManager({
  orgSlug,
  raffleId,
  canPublish,
}: {
  orgSlug: string;
  raffleId: number;
  canPublish: boolean;
}) {
  const endpoint = `/api/${orgSlug}/raffles/${raffleId}/telegram/publish`;
  const { data, mutate } = useSWR<PublicationData>(endpoint, fetcher);
  const [communityId, setCommunityId] = useState("");
  const [membershipRequired, setMembershipRequired] = useState(false);
  const [remainUntilEnd, setRemainUntilEnd] = useState(false);
  const [autoAnnouncements, setAutoAnnouncements] = useState(true);
  const [winnerVisibility, setWinnerVisibility] = useState<
    "PUBLIC" | "ANONYMOUS" | "ADMIN_ONLY"
  >("PUBLIC");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!communityId && data?.communities[0]) {
      setCommunityId(data.communities[0].id);
    }
  }, [communityId, data?.communities]);

  async function publish() {
    setBusy(true);
    setMessage("");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        communityId,
        membershipRequired,
        remainUntilEnd,
        autoAnnouncements,
        winnerVisibility,
      }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    setMessage(
      response.ok
        ? "Telegram publication queued."
        : (body.error ?? "Telegram publication failed."),
    );
    if (response.ok) await mutate();
  }

  return (
    <div className="kos-card mt-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-kos-muted">
            Telegram
          </h3>
          <p className="mt-1 text-xs text-kos-muted">
            {data?.publications.length
              ? `${data.publications.length} connected publication${data.publications.length === 1 ? "" : "s"}`
              : "Not published to Telegram"}
          </p>
        </div>
        {data?.publications.map((publication) => (
          <span
            key={publication.id}
            className="kos-badge border-[#229ED9]/30 text-[#7dd3fc]"
          >
            {data.communities.find(
              (community) => community.id === publication.communityId,
            )?.communityName ?? "Telegram"}
          </span>
        ))}
      </div>

      {canPublish ? (
        !data ? (
          <p className="mt-4 text-sm text-kos-muted">
            Loading Telegram options...
          </p>
        ) : data.communities.length === 0 ? (
          <p className="mt-4 text-sm text-kos-muted">
            Connect a Telegram community in{" "}
            <Link
              className="text-blue-300 hover:underline"
              href={`/${orgSlug}/settings`}
            >
              Settings
            </Link>{" "}
            first.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 border-t border-kos-border pt-4 lg:grid-cols-[minmax(12rem,1fr)_auto_auto_auto_auto] lg:items-end">
            <label className="text-xs text-kos-muted">
              Community
              <select
                className="kos-input mt-1"
                value={communityId}
                onChange={(event) => setCommunityId(event.target.value)}
              >
                {data.communities.map((community) => (
                  <option key={community.id} value={community.id}>
                    {community.communityName}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex h-10 items-center gap-2 text-xs text-kos-muted">
              <input
                type="checkbox"
                checked={membershipRequired}
                onChange={(event) =>
                  setMembershipRequired(event.target.checked)
                }
              />
              Must be a member
            </label>
            <label className="flex h-10 items-center gap-2 text-xs text-kos-muted">
              <input
                type="checkbox"
                checked={remainUntilEnd}
                onChange={(event) => setRemainUntilEnd(event.target.checked)}
                disabled={!membershipRequired}
              />
              Recheck at draw
            </label>
            <label className="text-xs text-kos-muted">
              Winners
              <select
                className="kos-input mt-1"
                value={winnerVisibility}
                onChange={(event) =>
                  setWinnerVisibility(
                    event.target.value as typeof winnerVisibility,
                  )
                }
              >
                <option value="PUBLIC">Public</option>
                <option value="ANONYMOUS">Anonymous</option>
                <option value="ADMIN_ONLY">Admin only</option>
              </select>
            </label>
            <button
              className="kos-btn-primary h-10"
              disabled={busy || !communityId}
              onClick={publish}
            >
              {busy ? "Queuing..." : "Publish"}
            </button>
            <label className="flex items-center gap-2 text-xs text-kos-muted lg:col-span-5">
              <input
                type="checkbox"
                checked={autoAnnouncements}
                onChange={(event) => setAutoAnnouncements(event.target.checked)}
              />
              Automatic reminders and results
            </label>
          </div>
        )
      ) : null}
      {message ? (
        <p
          className={`mt-3 text-sm ${message.includes("queued") ? "text-emerald-400" : "text-red-400"}`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
