"use client";

import useSWR from "swr";
import { useState } from "react";
import { useOrg, useCan } from "@/lib/org-context";
import { PERMISSIONS } from "@/lib/permissions";
import { SectionTitle, Empty } from "@/components/ui";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Member {
  userId: string;
  name: string;
  avatarUrl: string | null;
  roleId: string;
  roleName: string;
  status: string;
  isOwner: boolean;
}
interface Role {
  id: string;
  name: string;
  isSystem: boolean;
  permissions: string[];
}
interface TeamData {
  ownerId: string;
  members: Member[];
  roles: Role[];
  invites: { id: string; token: string; roleName: string; expiresAt: string }[];
  error?: string;
}

export function TeamManager() {
  const { slug } = useOrg();
  const canManage = useCan(PERMISSIONS.MEMBER_MANAGE);
  const isOwner = useOrg().isOwner;
  const { data, mutate } = useSWR<TeamData>(`/api/${slug}/team`, fetcher);
  const [discordId, setDiscordId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const roles = (data?.roles ?? []).filter((r) => r.name !== "Owner");
  const effectiveRole = roleId || roles[0]?.id || "";

  async function addMember() {
    setMsg(null);
    const res = await fetch(`/api/${slug}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ discordUserId: discordId.trim(), roleId: effectiveRole }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setDiscordId("");
      setMsg("Member added.");
      mutate();
    } else {
      setMsg(body.error ?? "Couldn't add member.");
    }
  }

  async function createInvite() {
    setMsg(null);
    const res = await fetch(`/api/${slug}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roleId: effectiveRole }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setInviteUrl(body.url);
      try {
        await navigator.clipboard.writeText(body.url);
        setMsg("Invite link copied to clipboard.");
      } catch {
        setMsg("Invite link created.");
      }
    } else {
      setMsg(body.error ?? "Couldn't create invite.");
    }
  }

  async function changeRole(userId: string, newRoleId: string) {
    await fetch(`/api/${slug}/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roleId: newRoleId }),
    });
    mutate();
  }

  async function removeMember(userId: string) {
    if (!confirm("Remove this member?")) return;
    await fetch(`/api/${slug}/members/${userId}`, { method: "DELETE" });
    mutate();
  }

  async function revokeInvite(id: string) {
    if (!confirm("Revoke this invite link? It will stop working.")) return;
    await fetch(`/api/${slug}/invites/${id}`, { method: "DELETE" });
    mutate();
  }

  async function transfer(userId: string, name: string) {
    if (!confirm(`Transfer ownership to ${name}? You'll become an Admin.`)) return;
    const res = await fetch(`/api/${slug}/transfer-owner`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) mutate();
    else {
      const b = await res.json().catch(() => ({}));
      setMsg(b.error ?? "Transfer failed.");
    }
  }

  if (data?.error) return <Empty>You don't have access to the team.</Empty>;

  return (
    <div className="space-y-6">
      {canManage ? (
        <div className="kos-card p-4">
          <SectionTitle>Invite a teammate</SectionTitle>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="kos-input"
              placeholder="Discord user ID (optional for link)"
              value={discordId}
              onChange={(e) => setDiscordId(e.target.value)}
            />
            <select className="kos-input sm:max-w-[180px]" value={effectiveRole} onChange={(e) => setRoleId(e.target.value)}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <button className="kos-btn whitespace-nowrap" onClick={addMember} disabled={!discordId.trim()}>
              Add by ID
            </button>
            <button className="kos-btn-primary whitespace-nowrap" onClick={createInvite}>
              Create link
            </button>
          </div>
          {inviteUrl ? (
            <div className="mt-3 truncate rounded-lg border border-kos-border bg-kos-panel px-3 py-2 text-xs text-kos-muted">
              {inviteUrl}
            </div>
          ) : null}
          {msg ? <p className="mt-2 text-sm text-kos-muted">{msg}</p> : null}
        </div>
      ) : null}

      <div>
        <SectionTitle>Members</SectionTitle>
        {!data ? (
          <Empty>Loading…</Empty>
        ) : (
          <div className="space-y-2">
            {data.members.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 rounded-xl border border-kos-border bg-kos-panel/50 p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-kos-panel text-[11px] font-bold">
                  {m.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    m.name.slice(0, 2).toUpperCase()
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {m.name}
                    {m.isOwner ? <span className="ml-2 text-[11px] text-kos-fg">Owner</span> : null}
                  </div>
                  <div className="text-[11px] text-kos-muted">{m.userId}</div>
                </div>

                {canManage && !m.isOwner ? (
                  <select
                    className="kos-input max-w-[150px] text-xs"
                    value={m.roleId}
                    onChange={(e) => changeRole(m.userId, e.target.value)}
                  >
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="kos-badge border-kos-border text-kos-muted">{m.roleName}</span>
                )}

                {isOwner && !m.isOwner ? (
                  <button className="kos-btn text-xs" onClick={() => transfer(m.userId, m.name)}>
                    Make owner
                  </button>
                ) : null}
                {canManage && !m.isOwner ? (
                  <button
                    className="rounded-lg px-2 py-1 text-xs text-kos-muted hover:text-red-400"
                    onClick={() => removeMember(m.userId)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {data?.invites && data.invites.length > 0 ? (
        <div>
          <SectionTitle>Pending invites</SectionTitle>
          <div className="space-y-2">
            {data.invites.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 rounded-xl border border-kos-border bg-kos-panel/50 p-3 text-sm">
                <span className="text-kos-muted">Link · {i.roleName}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-kos-muted">expires {new Date(i.expiresAt).toLocaleDateString()}</span>
                  {canManage ? (
                    <button
                      className="text-xs text-kos-muted hover:text-red-400"
                      onClick={() => revokeInvite(i.id)}
                    >
                      Revoke
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
