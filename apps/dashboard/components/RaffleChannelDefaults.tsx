"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useCan, useOrg } from "@/lib/org-context";
import { PERMISSIONS } from "@/lib/permissions";
import { Empty } from "@/components/ui";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ConnectedGuild {
  guildId: string;
  name: string;
  defaultRaffleChannelId: string | null;
  defaultAnnounceChannelId: string | null;
  defaultProofChannelId: string | null;
}
interface Channel {
  id: string;
  name: string;
}
interface Meta {
  channels: Channel[];
  hasBotToken: boolean;
  defaults?: {
    raffleChannelId: string | null;
    announceChannelId: string | null;
    proofChannelId: string | null;
  };
}

export function RaffleChannelDefaults() {
  const { slug } = useOrg();
  const canEdit = useCan(PERMISSIONS.SETTINGS_EDIT);
  const { data, mutate } = useSWR<{
    connected: ConnectedGuild[];
    error?: string;
  }>(`/api/${slug}/guilds`, fetcher);
  const connected = data?.connected ?? [];
  const [guildId, setGuildId] = useState("");
  const { data: meta } = useSWR<Meta>(
    guildId ? `/api/${slug}/guilds/${guildId}/meta` : null,
    fetcher,
  );
  const selected = useMemo(
    () => connected.find((g) => g.guildId === guildId) ?? connected[0] ?? null,
    [connected, guildId],
  );
  const [raffleChannelId, setRaffleChannelId] = useState("");
  const [announceChannelId, setAnnounceChannelId] = useState("");
  const [proofChannelId, setProofChannelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!guildId && connected[0]) setGuildId(connected[0].guildId);
  }, [connected, guildId]);

  useEffect(() => {
    if (!selected) return;
    setRaffleChannelId(selected.defaultRaffleChannelId ?? "");
    setAnnounceChannelId(selected.defaultAnnounceChannelId ?? "");
    setProofChannelId(selected.defaultProofChannelId ?? "");
    setMsg(null);
  }, [selected]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(
      `/api/${slug}/guilds/${selected.guildId}/defaults`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          raffleChannelId,
          announceChannelId,
          proofChannelId,
        }),
      },
    );
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMsg("Default raffle channels saved.");
      mutate();
    } else {
      setMsg(body.error ?? "Couldn't save default channels.");
    }
  }

  if (data?.error) return <Empty>{data.error}</Empty>;
  if (!data) return <Empty>Loading connected servers…</Empty>;
  if (connected.length === 0) {
    return <Empty>Connect a Discord server before setting raffle defaults.</Empty>;
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-kos-muted">
          Server
        </label>
        <select
          className="kos-input"
          value={selected?.guildId ?? ""}
          onChange={(e) => setGuildId(e.target.value)}
        >
          {connected.map((guild) => (
            <option key={guild.guildId} value={guild.guildId}>
              {guild.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <ChannelField
          label="Raffle posts"
          value={raffleChannelId}
          onChange={setRaffleChannelId}
          channels={meta?.channels ?? []}
          hasBotToken={meta?.hasBotToken ?? true}
          placeholder="Required for defaults"
        />
        <ChannelField
          label="Winners"
          value={announceChannelId}
          onChange={setAnnounceChannelId}
          channels={meta?.channels ?? []}
          hasBotToken={meta?.hasBotToken ?? true}
          emptyLabel="Same as raffle post"
        />
        <ChannelField
          label="Proof"
          value={proofChannelId}
          onChange={setProofChannelId}
          channels={meta?.channels ?? []}
          hasBotToken={meta?.hasBotToken ?? true}
          emptyLabel="Same as winners"
        />
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3 text-xs text-kos-muted">
        New raffles will prefill these channels automatically. Hosts can still
        change any channel inside the raffle builder before publishing.
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {canEdit ? (
          <button className="kos-btn-primary" disabled={busy || !selected}>
            {busy ? "Saving…" : "Save defaults"}
          </button>
        ) : (
          <span className="text-sm text-kos-muted">
            You need settings permission to change these defaults.
          </span>
        )}
        {msg ? <span className="text-sm text-kos-muted">{msg}</span> : null}
      </div>
    </form>
  );
}

function ChannelField({
  label,
  value,
  onChange,
  channels,
  hasBotToken,
  emptyLabel,
  placeholder = "Channel ID",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  channels: Channel[];
  hasBotToken: boolean;
  emptyLabel?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-kos-muted">
        {label}
      </span>
      {hasBotToken ? (
        <select
          className="kos-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{emptyLabel ?? "Select…"}</option>
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              #{channel.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="kos-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </label>
  );
}
