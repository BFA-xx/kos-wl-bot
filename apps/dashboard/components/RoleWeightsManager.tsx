"use client";

import useSWR from "swr";
import { useEffect, useMemo, useState } from "react";
import { Empty, SectionTitle } from "@/components/ui";
import { useCan, useOrg } from "@/lib/org-context";
import { PERMISSIONS } from "@/lib/permissions";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface GuildRow {
  guildId: string;
  name: string;
}

interface RoleRow {
  id: string;
  name: string;
}

interface WeightRow {
  guildId: string;
  roleId: string;
  roleName: string;
  multiplier: number;
}

export function RoleWeightsManager() {
  const { slug } = useOrg();
  const canEdit = useCan(PERMISSIONS.SETTINGS_EDIT);
  const { data: guilds } = useSWR<{ connected: GuildRow[] }>(
    `/api/${slug}/guilds`,
    fetcher,
  );
  const { data: weightsData, mutate } = useSWR<{ weights: WeightRow[] }>(
    `/api/${slug}/role-weights`,
    fetcher,
  );
  const [guildId, setGuildId] = useState("");
  const [local, setLocal] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const connected = guilds?.connected ?? [];
  const selectedGuild =
    connected.find((g) => g.guildId === guildId) ?? connected[0] ?? null;
  const effectiveGuildId = guildId || selectedGuild?.guildId || "";
  const { data: meta } = useSWR<{ roles: RoleRow[]; hasBotToken: boolean }>(
    effectiveGuildId ? `/api/${slug}/guilds/${effectiveGuildId}/meta` : null,
    fetcher,
  );
  const weights = weightsData?.weights ?? [];
  const storedForGuild = useMemo(
    () =>
      new Map(
        weights
          .filter((w) => w.guildId === effectiveGuildId)
          .map((w) => [w.roleId, w.multiplier]),
      ),
    [weights, effectiveGuildId],
  );

  useEffect(() => {
    if (!guildId && connected[0]) setGuildId(connected[0].guildId);
  }, [connected, guildId]);

  useEffect(() => {
    if (!effectiveGuildId || !meta?.roles) return;
    setLocal(
      Object.fromEntries(
        meta.roles.map((role) => [role.id, storedForGuild.get(role.id) ?? 1]),
      ),
    );
  }, [effectiveGuildId, meta?.roles, storedForGuild]);

  async function save() {
    if (!effectiveGuildId || !meta?.roles) return;
    setBusy(true);
    setMsg(null);
    const currentGuildWeights: WeightRow[] = meta.roles
      .map((role) => ({
        guildId: effectiveGuildId,
        roleId: role.id,
        roleName: role.name,
        multiplier: Math.max(1, Math.min(10, Math.round(local[role.id] ?? 1))),
      }))
      .filter((w) => w.multiplier > 1);
    const otherGuildWeights = weights.filter(
      (w) => w.guildId !== effectiveGuildId,
    );
    const res = await fetch(`/api/${slug}/role-weights`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        weights: [...otherGuildWeights, ...currentGuildWeights],
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMsg("Role weights saved.");
      await mutate();
    } else {
      setMsg(body.error ?? "Couldn't save role weights.");
    }
  }

  if (!guilds) return <Empty>Loading role weights…</Empty>;
  if (connected.length === 0)
    return (
      <Empty>
        Connect a Discord server before setting weighted draw roles.
      </Empty>
    );

  const roles = meta?.roles ?? [];
  const activeCount = Object.values(local).filter((v) => v > 1).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <label className="kos-label">Server</label>
          <select
            className="kos-input max-w-md"
            value={effectiveGuildId}
            onChange={(e) => setGuildId(e.target.value)}
            disabled={!canEdit}
          >
            {connected.map((g) => (
              <option key={g.guildId} value={g.guildId}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="kos-metric min-w-32 text-sm">
          <div className="text-lg font-semibold">{activeCount}</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-kos-muted">
            weighted roles
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-white/[0.08] bg-white/[0.025] p-3">
        <SectionTitle>Multipliers</SectionTitle>
        {!meta ? (
          <p className="p-3 text-sm text-kos-muted">Loading server roles…</p>
        ) : !meta.hasBotToken ? (
          <p className="p-3 text-sm text-kos-muted">
            Add the bot token/server metadata to manage role weights visually.
          </p>
        ) : roles.length === 0 ? (
          <p className="p-3 text-sm text-kos-muted">
            No roles found for this server.
          </p>
        ) : (
          <div className="grid gap-2">
            {roles.slice(0, 80).map((role) => {
              const value = local[role.id] ?? 1;
              const pct = ((value - 1) / 9) * 100;
              return (
                <div
                  key={role.id}
                  className="rounded-2xl border border-white/[0.08] bg-black/10 p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {role.name}
                      </div>
                      <div className="text-[11px] text-kos-muted">
                        {value === 1 ? "Default odds" : `${value}× draw weight`}
                      </div>
                    </div>
                    <span className="kos-badge border-blue-400/20 text-blue-300">
                      {value}×
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    value={value}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setLocal((m) => ({
                        ...m,
                        [role.id]: Number(e.target.value),
                      }))
                    }
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/[0.08] accent-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      background: `linear-gradient(90deg, rgb(59 130 246) ${pct}%, rgba(255,255,255,0.08) ${pct}%)`,
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-kos-muted">
          Weighted raffles snapshot each entrant's highest matching role
          multiplier at entry time. A 5× role gives five tickets in the
          deterministic draw, not five visible entries.
        </p>
        {canEdit ? (
          <button
            onClick={save}
            disabled={busy || !meta?.roles}
            className="kos-btn-primary shrink-0"
          >
            {busy ? "Saving…" : "Save weights"}
          </button>
        ) : null}
      </div>
      {msg ? <p className="text-sm text-kos-muted">{msg}</p> : null}
    </div>
  );
}
