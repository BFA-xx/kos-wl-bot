"use client";

import { useState } from "react";
import useSWR from "swr";
import { Card, Empty, SectionTitle } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import {
  KOS_NOTIFICATION_KEYS,
  KOS_NOTIFICATION_LABELS,
  type KosNotificationKey,
} from "@/lib/kos/notifications";
import type { KosMemberResponse } from "@/lib/kos/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const APPROVAL_TONE: Record<string, string> = {
  APPROVED: "border-emerald-400/30 text-emerald-500 dark:text-emerald-300/90",
  PENDING: "border-amber-400/30 text-amber-500 dark:text-amber-300/90",
  REJECTED: "border-rose-400/30 text-rose-500 dark:text-rose-300/90",
};

export function KosStandingCard() {
  const { data, mutate } = useSWR<KosMemberResponse>("/api/me/kos", fetcher);
  const [saving, setSaving] = useState<KosNotificationKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!data) return null;

  if (!data.linked) {
    return (
      <>
        <SectionTitle>KOS standing</SectionTitle>
        <Empty>
          Connect Telegram above to start earning KOS points, invite friends,
          and request community access. Your points follow your KOS identity, so
          they show up here too.
        </Empty>
      </>
    );
  }

  async function toggle(key: KosNotificationKey, next: boolean) {
    if (!data?.linked) return;
    setSaving(key);
    setError(null);
    // Optimistic: the row is authoritative, so reconcile with the response.
    await mutate(
      async (current) => {
        const res = await fetch("/api/me/kos/notifications", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ [key]: next }),
        });
        const body = await res.json();
        if (!res.ok) {
          setError(body.error ?? "Could not save that preference.");
          return current;
        }
        return current && current.linked
          ? { ...current, notifications: body.notifications }
          : current;
      },
      {
        optimisticData: (current) =>
          current && current.linked
            ? {
                ...current,
                notifications: { ...current.notifications, [key]: next },
              }
            : (current as KosMemberResponse),
        revalidate: false,
        rollbackOnError: true,
      },
    ).catch(() => setError("Could not save that preference."));
    setSaving(null);
  }

  const { points, referral, communities, notifications } = data;
  const toNext = points.nextLevel
    ? Math.max(0, points.nextLevel.minPoints - points.points)
    : 0;

  return (
    <>
      <SectionTitle>KOS standing</SectionTitle>
      <div className="space-y-3">
        <Card>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-kos-muted">
                KOS points
              </div>
              <div className="mt-1 text-3xl font-semibold tracking-tight">
                {points.points}
              </div>
            </div>
            <div className="text-right text-sm">
              <div className="font-semibold">
                {points.level ? points.level.name : "Unranked"}
              </div>
              <div className="text-kos-muted">
                {points.nextLevel
                  ? `${toNext} to ${points.nextLevel.name}`
                  : "Top level reached"}
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-kos-muted">
            KOS points are earned across every KOS surface and follow your
            identity, not a single community. They are separate from the
            per-community points below.
          </p>
        </Card>

        <Card>
          <div className="text-sm font-semibold">Invite friends</div>
          {referral.code ? (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="rounded-lg border border-white/[0.08] bg-black/20 px-2.5 py-1.5 text-sm">
                  {referral.code}
                </code>
                <span className="text-xs text-kos-muted">
                  {referral.completed} joined · {referral.pending} pending
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-kos-muted">
                Share this code. It pays out once your invite finishes
                onboarding and a team approves their access.
              </p>
            </>
          ) : (
            <p className="mt-2 text-xs leading-5 text-kos-muted">
              Your invite code is issued when you start KOS onboarding.
            </p>
          )}
        </Card>

        {communities.length > 0 ? (
          <Card>
            <div className="text-sm font-semibold">Community access</div>
            <ul className="mt-3 space-y-2">
              {communities.map((community) => (
                <li
                  key={community.communityId}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span className="min-w-0 break-words">
                    {community.communityName}
                    {community.status !== "ACTIVE" ? (
                      <span className="ml-2 text-xs text-kos-muted">
                        not in the group
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={`kos-badge ${
                      APPROVAL_TONE[community.approvalStatus] ?? ""
                    }`}
                    title={`Requested ${fmtDate(community.requestedAt)}`}
                  >
                    {community.approvalStatus.toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card>
          <div className="text-sm font-semibold">KOS notifications</div>
          <p className="mt-1 text-xs leading-5 text-kos-muted">
            These are the same switches as KOS Bot&apos;s /notifications.
          </p>
          <div className="mt-3 space-y-2">
            {KOS_NOTIFICATION_KEYS.map((key) => (
              <label
                key={key}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span>{KOS_NOTIFICATION_LABELS[key]}</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-blue-500"
                  checked={notifications[key]}
                  disabled={saving === key}
                  onChange={(event) => toggle(key, event.target.checked)}
                />
              </label>
            ))}
          </div>
          {error ? <p className="mt-2 text-xs text-rose-400">{error}</p> : null}
        </Card>
      </div>
    </>
  );
}
