"use client";

import { useId } from "react";

export interface AreaPoint {
  label: string;
  value: number;
}

/**
 * Simple, dependency-free SVG area + line chart. Theme-aware via currentColor
 * (the wrapper sets text-kos-fg). Fed by the overview `series` (entries per
 * bucket). Stretches to fill width; stroke stays crisp via non-scaling-stroke.
 */
export function AreaChart({ data }: { data: AreaPoint[] }) {
  const gradId = useId();
  if (data.length === 0) {
    return <div className="flex h-44 items-center justify-center text-sm text-kos-muted">No entries yet.</div>;
  }

  const W = 600;
  const H = 160;
  const pad = 8;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length;
  const x = (i: number) => (n === 1 ? W / 2 : pad + (i / (n - 1)) * (W - pad * 2));
  const y = (val: number) => H - pad - (val / max) * (H - pad * 2);

  const line = data.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = `M ${x(0).toFixed(1)},${H} L ${data
    .map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`)
    .join(" L ")} L ${x(n - 1).toFixed(1)},${H} Z`;

  const total = data.reduce((a, d) => a + d.value, 0);
  const lastValue = data[n - 1]?.value ?? 0;

  return (
    <div className="text-kos-fg">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold">{total}</span>
        <span className="text-xs text-kos-muted">entries · {lastValue} latest</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradId})`} />
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-2 flex justify-between">
        {data.map((d, i) => (
          <span key={i} className="text-[10px] text-kos-muted">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
