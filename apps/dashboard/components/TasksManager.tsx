"use client";

import useSWR from "swr";
import { useEffect, useState } from "react";
import { useOrg } from "@/lib/org-context";
import { SectionTitle, Empty } from "@/components/ui";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const TYPES = [
  { value: "X_FOLLOW", label: "Follow on X" },
  { value: "X_LIKE", label: "Like a post on X" },
  { value: "X_REPOST", label: "Repost on X" },
  { value: "X_COMMENT", label: "Comment on X" },
  { value: "DISCORD_JOIN", label: "Join a Discord server" },
  { value: "DISCORD_ROLE", label: "Hold a Discord role" },
  { value: "VISIT_LINK", label: "Visit a link" },
  { value: "MANUAL", label: "Manual review" },
];

interface Task {
  id: string;
  type: string;
  title: string;
  description: string | null;
  points: number;
  active: boolean;
  verifiedCount: number;
}
interface Review {
  id: string;
  taskTitle: string;
  taskType: string;
  userName: string;
  userId: string;
  submittedAt: string;
}

export function TasksManager() {
  const { slug } = useOrg();
  const { data, mutate } = useSWR<{ tasks: Task[]; error?: string }>(`/api/${slug}/tasks`, fetcher);
  const { data: reviews, mutate: mutateReviews } = useSWR<{ reviews: Review[] }>(
    `/api/${slug}/reviews`,
    fetcher,
    { refreshInterval: 15000 },
  );
  const { data: guilds } = useSWR<{ connected: { guildId: string; name: string }[] }>(
    `/api/${slug}/guilds`,
    fetcher,
  );

  const [type, setType] = useState("X_FOLLOW");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [points, setPoints] = useState(0);
  const [xHandle, setXHandle] = useState("");
  const [tweetUrl, setTweetUrl] = useState("");
  const [url, setUrl] = useState("");
  const [guildId, setGuildId] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [roleId, setRoleId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveGuild = guildId || guilds?.connected?.[0]?.guildId || "";

  useEffect(() => {
    if (type === "DISCORD_ROLE" && effectiveGuild) {
      fetcher(`/api/${slug}/guilds/${effectiveGuild}/meta`).then((m) => setRoles(m.roles ?? []));
    }
  }, [type, effectiveGuild, slug]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/${slug}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type,
        title,
        description,
        points: Number(points) || 0,
        config: {
          xHandle,
          tweetUrl,
          url,
          guildId: effectiveGuild,
          inviteUrl,
          roleId,
          roleName: roles.find((r) => r.id === roleId)?.name,
          instructions,
        },
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setTitle("");
      setDescription("");
      setXHandle("");
      setTweetUrl("");
      setUrl("");
      setInstructions("");
      setMsg("Task created.");
      mutate();
    } else {
      setMsg(body.error ?? "Couldn't create the task.");
    }
  }

  async function toggle(t: Task) {
    await fetch(`/api/${slug}/tasks/${t.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !t.active }),
    });
    mutate();
  }

  async function remove(t: Task) {
    if (!confirm(`Delete "${t.title}"? Completions and raffle links are removed too.`)) return;
    await fetch(`/api/${slug}/tasks/${t.id}`, { method: "DELETE" });
    mutate();
  }

  async function decide(id: string, decision: "approve" | "reject") {
    await fetch(`/api/${slug}/reviews/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    mutateReviews();
  }

  if (data?.error) return <Empty>You don't have permission to manage tasks.</Empty>;

  const isX = type.startsWith("X_");
  const isDiscord = type.startsWith("DISCORD_");

  return (
    <div className="space-y-6">
      <div className="kos-card p-4">
        <SectionTitle>Create a task</SectionTitle>
        <form onSubmit={create} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <select className="kos-input" value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <input
              className="kos-input"
              placeholder="Title (e.g. Follow @KOS on X)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          {type === "X_FOLLOW" ? (
            <input className="kos-input" placeholder="X handle to follow (e.g. KOS)" value={xHandle} onChange={(e) => setXHandle(e.target.value)} />
          ) : null}
          {isX && type !== "X_FOLLOW" ? (
            <input className="kos-input" placeholder="Post URL (https://x.com/…/status/…)" value={tweetUrl} onChange={(e) => setTweetUrl(e.target.value)} />
          ) : null}
          {type === "VISIT_LINK" ? (
            <input className="kos-input" placeholder="https://yourproject.xyz" value={url} onChange={(e) => setUrl(e.target.value)} />
          ) : null}
          {isDiscord ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <select className="kos-input" value={effectiveGuild} onChange={(e) => setGuildId(e.target.value)}>
                {(guilds?.connected ?? []).map((g) => (
                  <option key={g.guildId} value={g.guildId}>
                    {g.name}
                  </option>
                ))}
              </select>
              {type === "DISCORD_JOIN" ? (
                <input className="kos-input" placeholder="Invite link (https://discord.gg/…)" value={inviteUrl} onChange={(e) => setInviteUrl(e.target.value)} />
              ) : (
                <select className="kos-input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                  <option value="">Pick a role…</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : null}
          {type === "MANUAL" ? (
            <textarea className="kos-input min-h-[60px]" placeholder="Instructions for the member (what to do + what proof to provide)" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <input className="kos-input" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
            <div className="flex items-center gap-2">
              <input type="number" min={0} className="kos-input max-w-[110px]" value={points} onChange={(e) => setPoints(Number(e.target.value))} />
              <span className="text-xs text-kos-muted">points members earn on verification</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button type="submit" className="kos-btn-primary" disabled={busy || !title.trim()}>
              {busy ? "Creating…" : "Create task"}
            </button>
            {msg ? <span className="text-sm text-kos-muted">{msg}</span> : null}
          </div>
        </form>
      </div>

      <div>
        <SectionTitle>Your tasks</SectionTitle>
        {!data ? (
          <Empty>Loading…</Empty>
        ) : data.tasks.length === 0 ? (
          <Empty>No tasks yet — create one above, then attach it to a raffle.</Empty>
        ) : (
          <div className="space-y-2">
            {data.tasks.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-kos-border bg-kos-panel/50 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t.title}</span>
                    <span className="kos-badge border-kos-border text-kos-muted">
                      {TYPES.find((x) => x.value === t.type)?.label ?? t.type}
                    </span>
                    {t.points > 0 ? <span className="kos-badge border-kos-border text-kos-muted">+{t.points} pts</span> : null}
                    {!t.active ? <span className="kos-badge border-amber-400/30 text-amber-400">disabled</span> : null}
                  </div>
                  <div className="text-xs text-kos-muted">{t.verifiedCount} verified{t.description ? ` · ${t.description}` : ""}</div>
                </div>
                <button className="kos-btn text-xs" onClick={() => toggle(t)}>
                  {t.active ? "Disable" : "Enable"}
                </button>
                <button className="px-2 text-xs text-kos-muted hover:text-red-400" onClick={() => remove(t)}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionTitle>Review queue</SectionTitle>
        {!reviews || reviews.reviews.length === 0 ? (
          <Empty>No submissions waiting for review.</Empty>
        ) : (
          <div className="space-y-2">
            {reviews.reviews.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-kos-border bg-kos-panel/50 p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{r.userName}</div>
                  <div className="text-xs text-kos-muted">
                    {r.taskTitle} · {new Date(r.submittedAt).toLocaleString()}
                  </div>
                </div>
                <button className="kos-btn-primary text-xs" onClick={() => decide(r.id, "approve")}>
                  Approve
                </button>
                <button className="kos-btn text-xs" onClick={() => decide(r.id, "reject")}>
                  Reject
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
