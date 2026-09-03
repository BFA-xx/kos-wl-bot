"use client";

import useSWR from "swr";
import { Card, Empty, SectionTitle } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import type { KosMemberResponse } from "@/lib/kos/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Global KOS points on the website. The balance a member sees in KOS Bot has
 * to be the balance they see here — same identity, same ledger, one number.
 */
export function KosPointsSection() {
  const { data } = useSWR<KosMemberResponse>("/api/me/kos", fetcher, {
    refreshInterval: 30000,
  });

  if (!data || !data.linked) return null;

  const { points, recentAwards } = data;
  const span =
    points.nextLevel && points.level
      ? points.nextLevel.minPoints - points.level.minPoints
      : 0;
  const progress =
    span > 0 && points.level
      ? Math.min(
          100,
          Math.max(
            0,
            Math.round(((points.points - points.level.minPoints) / span) * 100),
          ),
        )
      : points.nextLevel
        ? 0
        : 100;

  return (
    <div className="mt-8">
      <SectionTitle>KOS points</SectionTitle>
      <div className="grid gap-3 lg:grid-cols-[24rem_1fr]">
        <Card>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-3xl font-semibold tracking-tight">
                {points.points}
              </div>
              <div className="text-xs text-kos-muted">
                {points.level ? points.level.name : "Unranked"}
              </div>
            </div>
            {points.nextLevel ? (
              <div className="text-right text-xs text-kos-muted">
                {points.nextLevel.minPoints - points.points} to
                <br />
                {points.nextLevel.name}
              </div>
            ) : null}
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-3 text-xs leading-5 text-kos-muted">
            Earned across every KOS surface and tied to your KOS identity, so
            this total is the same one KOS Bot shows in Telegram. The balances
            above are per-community and are what the rewards store spends.
          </p>
        </Card>

        <div>
          {recentAwards.length === 0 ? (
            <Empty>
              No KOS points yet. Finish onboarding and enter a raffle to start
              earning.
            </Empty>
          ) : (
            <div className="grid gap-2">
              {recentAwards.map((award) => (
                <div
                  key={award.id}
                  className="kos-card flex items-center gap-3 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {award.reason}
                    </div>
                    <div className="truncate text-xs text-kos-muted">
                      {award.event.toLowerCase().replace(/_/gu, " ")}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold text-emerald-400">
                      +{award.amount}
                    </div>
                    <div className="text-[10px] text-kos-muted">
                      {fmtDate(award.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
