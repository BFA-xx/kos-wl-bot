"use client";

import useSWR from "swr";
import { useState } from "react";
import { useOrg, useCan } from "@/lib/org-context";
import { PERMISSIONS } from "@/lib/permissions";
import { SectionTitle, Empty } from "@/components/ui";
import { IconServer, IconPlus, IconCheck } from "@/components/icons";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Manageable {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  connectedHere: boolean;
  connectedElsewhere: boolean;
}
interface Connected {
  id: string;
  guildId: string;
  name: string;
  icon: string | null;
  isPrimary: boolean;
}

export function ServersManager() {
  const { slug } = useOrg();
  const canConnect = useCan(PERMISSIONS.GUILD_CONNECT);
  const { data, mutate } = useSWR<{
    guilds: Manageable[];
    connected: Connected[];
    inviteBase: string;
    error?: string;
  }>(`/api/${slug}/guilds`, fetcher);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function connect(guildId: string) {
    setBusy(guildId);
    setMsg(null);
    const res = await fetch(`/api/${slug}/guilds/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guildId }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok) {
      setMsg("Server connected.");
      mutate();
    } else if (body.error === "bot_not_in_server" && body.inviteUrl) {
      window.open(body.inviteUrl, "_blank");
      setMsg("Invite the KOS bot, then click Connect again.");
    } else {
      setMsg(body.error ?? "Couldn't connect that server.");
    }
  }

  async function disconnect(id: string) {
    if (!confirm("Disconnect this server? Its raffles will no longer appear here.")) return;
    setBusy(id);
    await fetch(`/api/${slug}/guilds/${id}`, { method: "DELETE" });
    setBusy(null);
    mutate();
  }

  const connected = data?.connected ?? [];
  const addable = (data?.guilds ?? []).filter((g) => !g.connectedHere);
  // Bot invite link with the server preselected.
  const inviteFor = (id: string) =>
    data?.inviteBase ? `${data.inviteBase}&guild_id=${id}&disable_guild_select=true` : "#";

  return (
    <div className="space-y-5">
      <div>
        <SectionTitle>Connected servers</SectionTitle>
        {connected.length === 0 ? (
          <Empty>No servers connected yet. Add one below.</Empty>
        ) : (
          <div className="space-y-2">
            {connected.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-xl border border-kos-border bg-kos-panel/50 p-3">
                <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-kos-fg/90 text-[10px] font-bold text-kos-bg">
                  {c.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.icon} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <IconServer />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  <div className="text-[11px] text-kos-muted">
                    {c.guildId}
                    {c.isPrimary ? " · primary" : ""}
                  </div>
                </div>
                {canConnect ? (
                  <button
                    className="kos-btn"
                    onClick={() => disconnect(c.id)}
                    disabled={busy === c.id}
                  >
                    {busy === c.id ? "…" : "Disconnect"}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {canConnect ? (
        <div>
          <SectionTitle>Add a server</SectionTitle>
          {data?.error === "reconnect_discord" ? (
            <Empty>
              Your Discord session expired.{" "}
              <a className="underline" href="/api/auth/discord/login">
                Reconnect
              </a>
              .
            </Empty>
          ) : !data ? (
            <Empty>Loading your servers…</Empty>
          ) : addable.length === 0 ? (
            <Empty>No more servers you manage. Only servers where you're owner/admin appear here.</Empty>
          ) : (
            <>
            <div className="space-y-2">
              {addable.map((g) => (
                <div key={g.id} className="flex items-center gap-3 rounded-xl border border-kos-border bg-kos-panel/50 p-3">
                  <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-kos-panel text-[10px] font-bold text-kos-muted">
                    {g.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.icon} alt="" className="h-full w-full object-cover" />
                    ) : (
                      g.name.slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{g.name}</div>
                    <div className="text-[11px] text-kos-muted">
                      {g.owner ? "Owner" : "Admin"}
                      {g.connectedElsewhere ? " · connected to another org" : ""}
                    </div>
                  </div>
                  {!g.connectedElsewhere ? (
                    <a
                      href={inviteFor(g.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="kos-btn whitespace-nowrap"
                      title="Add the KOS bot to this server"
                    >
                      Invite bot ↗
                    </a>
                  ) : null}
                  <button
                    className="kos-btn-primary inline-flex items-center gap-1.5"
                    onClick={() => connect(g.id)}
                    disabled={busy === g.id || g.connectedElsewhere}
                  >
                    {busy === g.id ? "…" : <><IconPlus /> Connect</>}
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-kos-muted/80">
              Step 1: click <strong>Invite bot</strong> and authorize KOS in your
              server. Step 2: click <strong>Connect</strong>.
            </p>
            </>
          )}
          {msg ? (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-kos-muted">
              <IconCheck className="text-kos-fg" /> {msg}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
