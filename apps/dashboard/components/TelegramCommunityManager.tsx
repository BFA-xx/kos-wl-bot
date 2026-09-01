"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { useOrg, useCan } from "@/lib/org-context";
import { PERMISSIONS } from "@/lib/permissions";

const fetcher = (url: string) => fetch(url).then((response) => response.json());
const FLAGS = [
  ["QUICK_RAFFLES", "Quick raffles"],
  ["ONBOARDING", "Onboarding"],
  ["AUTO_ANNOUNCEMENTS", "Auto announcements"],
  ["MEMBERSHIP_CHECKS", "Membership checks"],
] as const;

interface Community {
  id: string;
  telegramChatId: string;
  backingGuildId: string;
  communityName: string;
  status: "ACTIVE" | "DISABLED";
  featureFlags: string[];
  botVerifiedAt: string | null;
  _count: { publications: number };
}

interface CommunityData {
  communities: Community[];
  guilds: { id: string; name: string }[];
  error?: string;
}

export function TelegramCommunityManager() {
  const { slug } = useOrg();
  const canEdit = useCan(PERMISSIONS.SETTINGS_EDIT);
  const { data, mutate } = useSWR<CommunityData>(
    `/api/${slug}/integrations/telegram/communities`,
    fetcher,
  );
  const [chatId, setChatId] = useState("");
  const [name, setName] = useState("");
  const [guildId, setGuildId] = useState("");
  const [flags, setFlags] = useState<string[]>([
    "ONBOARDING",
    "AUTO_ANNOUNCEMENTS",
    "MEMBERSHIP_CHECKS",
  ]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!guildId && data?.guilds[0]) setGuildId(data.guilds[0].id);
  }, [data?.guilds, guildId]);

  function toggleFlag(flag: string) {
    setFlags((current) =>
      current.includes(flag)
        ? current.filter((item) => item !== flag)
        : [...current, flag],
    );
  }

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setBusy("connect");
    setMessage("");
    const response = await fetch(
      `/api/${slug}/integrations/telegram/communities`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          telegramChatId: chatId,
          communityName: name,
          backingGuildId: guildId,
          featureFlags: flags,
        }),
      },
    );
    const body = await response.json().catch(() => ({}));
    setBusy("");
    setMessage(
      response.ok
        ? "Telegram community connected."
        : (body.error ?? "Community could not be connected."),
    );
    if (response.ok) {
      setChatId("");
      setName("");
      await mutate();
    }
  }

  async function updateCommunity(
    community: Community,
    patch: { status?: Community["status"]; featureFlags?: string[] },
  ) {
    setBusy(community.id);
    setMessage("");
    const response = await fetch(
      `/api/${slug}/integrations/telegram/communities/${community.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: patch.status ?? community.status,
          featureFlags: patch.featureFlags ?? community.featureFlags,
        }),
      },
    );
    const body = await response.json().catch(() => ({}));
    setBusy("");
    setMessage(
      response.ok
        ? "Community settings updated."
        : (body.error ?? "Update failed."),
    );
    if (response.ok) await mutate();
  }

  async function setStatus(community: Community) {
    await updateCommunity(community, {
      status: community.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
    });
  }

  async function toggleCommunityFlag(community: Community, flag: string) {
    await updateCommunity(community, {
      featureFlags: community.featureFlags.includes(flag)
        ? community.featureFlags.filter((item) => item !== flag)
        : [...community.featureFlags, flag],
    });
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-3">
        {!data ? (
          <p className="text-sm text-kos-muted">
            Loading Telegram communities...
          </p>
        ) : data.communities.length === 0 ? (
          <div className="rounded-lg border border-dashed border-kos-border p-4 text-sm text-kos-muted">
            No Telegram communities connected.
          </div>
        ) : (
          data.communities.map((community) => (
            <div
              key={community.id}
              className="flex flex-col gap-3 border-b border-kos-border pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {community.communityName}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-kos-muted">
                  <span>{community.telegramChatId}</span>
                  <span>{community._count.publications} publications</span>
                  <span>{community.featureFlags.length} features</span>
                </div>
                {canEdit ? (
                  <div className="mt-2 grid gap-1.5 min-[440px]:grid-cols-2">
                    {FLAGS.map(([flag, label]) => (
                      <label
                        key={flag}
                        className="flex items-center gap-2 text-xs text-kos-muted"
                      >
                        <input
                          type="checkbox"
                          checked={community.featureFlags.includes(flag)}
                          disabled={Boolean(busy)}
                          onChange={() =>
                            void toggleCommunityFlag(community, flag)
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
              <span
                className={`kos-badge ${
                  community.status === "ACTIVE"
                    ? "border-emerald-400/30 text-emerald-300"
                    : "text-kos-muted"
                }`}
              >
                {community.status.toLowerCase()}
              </span>
              {canEdit ? (
                <button
                  className="kos-btn text-xs"
                  disabled={Boolean(busy)}
                  onClick={() => setStatus(community)}
                >
                  {busy === community.id
                    ? "Working..."
                    : community.status === "ACTIVE"
                      ? "Disable"
                      : "Enable"}
                </button>
              ) : null}
            </div>
          ))
        )}
        {message ? (
          <p
            className={`text-sm ${message.includes("connected") || message.includes("updated") ? "text-emerald-400" : "text-red-400"}`}
          >
            {message}
          </p>
        ) : null}
      </div>

      {canEdit ? (
        <form
          onSubmit={connect}
          className="space-y-3 border-t border-kos-border pt-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0"
        >
          <label className="block text-xs text-kos-muted">
            Telegram chat ID
            <input
              className="kos-input mt-1"
              value={chatId}
              onChange={(event) => setChatId(event.target.value)}
              placeholder="-1001234567890"
              required
            />
          </label>
          <label className="block text-xs text-kos-muted">
            Display name
            <input
              className="kos-input mt-1"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="KOS Labs"
            />
          </label>
          <label className="block text-xs text-kos-muted">
            Backing Discord server
            <select
              className="kos-input mt-1"
              value={guildId}
              onChange={(event) => setGuildId(event.target.value)}
              required
            >
              {(data?.guilds ?? []).map((guild) => (
                <option key={guild.id} value={guild.id}>
                  {guild.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {FLAGS.map(([flag, label]) => (
              <label
                key={flag}
                className="flex items-center gap-2 text-xs text-kos-muted"
              >
                <input
                  type="checkbox"
                  checked={flags.includes(flag)}
                  onChange={() => toggleFlag(flag)}
                />
                {label}
              </label>
            ))}
          </div>
          <button
            className="kos-btn-primary w-full"
            disabled={busy === "connect" || !guildId}
          >
            {busy === "connect" ? "Verifying..." : "Connect community"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
